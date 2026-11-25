// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { KernelMessage } from '@jupyterlab/services';
import { CancellationError, CancellationToken, CancellationTokenSource } from 'vscode';
import { createDeferred } from '../platform/common/utils/async';
import { isCancellationError } from '../platform/common/cancellation';
import { noop } from '../platform/common/utils/misc';
import { StopWatch } from '../platform/common/utils/stopWatch';
import { IKernelStartup } from './types';

/**
 * Final classification of a monitored kernel startup, reported once when recovery finalizes.
 * - `healthy`: startup completed without ever needing a recovery probe.
 * - `recovered`: startup completed, but only after one or more fresh-peer probes nudged the kernel.
 * - `timeout`: the no-progress budget was exhausted before the kernel made progress.
 * - `cancelled`: startup was cancelled (e.g. the user cancelled, or the kernel was disposed).
 * - `failed`: startup failed for some other reason.
 */
export type KernelStartupRecoveryOutcome = 'healthy' | 'recovered' | 'timeout' | 'cancelled' | 'failed';

/**
 * Telemetry summary emitted exactly once when a monitored startup finalizes.
 * Used to measure how often recovery is needed and how long startup takes.
 */
export interface KernelStartupRecoveryReport {
    /** Number of fresh-peer recovery probes attempted (0 for a healthy startup). */
    probeCount: number;
    /** Total wall-clock duration of the monitored startup, in milliseconds. */
    durationMs: number;
    /** Final classification of the startup. */
    outcome: KernelStartupRecoveryOutcome;
}

/**
 * Coordinates recovery of a stuck raw Python kernel startup on Windows (issue #17481).
 *
 * Background: with ipykernel 7 there is an IOPub/XPUB subscription race. The client's SUB socket
 * can connect to the kernel's XPUB a fraction too late, so the kernel never sees the subscription
 * and the "starting -> idle" IOPub handshake the client is waiting for is silently dropped. The
 * original startup request then waits forever and the notebook is stuck on "Connecting to kernel".
 *
 * This class solves that with two cooperating mechanisms:
 *
 * 1. A **no-progress communication budget**. `remaining` is a time budget that only *charges*
 *    (counts down) while the kernel looks like it is making no progress — i.e. there is at least
 *    one unacknowledged shell request (or a pending auxiliary/probe request) and nothing is
 *    currently acknowledged-but-busy. The instant the kernel acknowledges a request and goes busy,
 *    the budget pauses, because a slow-but-working kernel (e.g. long startup commands) is making
 *    progress and must never be failed. This makes detection accurate: only a kernel that is not
 *    responding at all can exhaust the budget.
 *
 * 2. A **fresh-peer recovery probe**. While the kernel appears stuck, `monitor()` periodically runs
 *    the injected `probe` callback, which opens a brand-new ZMQ peer and sends a signed
 *    `kernel_info_request`. A new peer connecting to the kernel's shell socket re-triggers the
 *    XPUB/subscription state so the missed IOPub handshake is delivered and the original request
 *    unblocks.
 *
 * Message bookkeeping (`sent`/`received`/`auxiliary*`) feeds the budget and tells the monitor when
 * the kernel is genuinely idle, so recovery stops as soon as startup succeeds.
 */
export class KernelStartupRecovery implements IKernelStartup {
    private readonly clock = new StopWatch();
    private readonly cancellation = new CancellationTokenSource();
    /** Rejected when startup fails/times out; every internal wait races against this. */
    private readonly failed = createDeferred<never>();
    /** Resolved (and replaced) whenever bookkeeping changes, so waiters re-evaluate. */
    private changed = createDeferred<void>();
    /** Tracked outstanding shell `_request` messages keyed by msg_id: has it been replied to / seen idle / acknowledged at all. */
    private readonly requests = new Map<string, { reply: boolean; idle: boolean; acknowledged: boolean }>();
    /** msg_ids of in-flight recovery-probe requests we are still waiting on. */
    private readonly auxiliary = new Set<string>();
    /** Remaining no-progress budget in ms; only decremented while `charging`. */
    private remaining: number;
    /** Minimum continuous no-progress time before probing, and minimum spacing between probes. */
    private readonly interval: number;
    /** Timestamp (clock ms) since which the kernel has continuously appeared to make no progress; undefined when progressing. */
    private eligibleSince?: number;
    /** Timestamp (clock ms) of the last probe attempt, used to space probes by `interval`. */
    private lastAttempt = -Infinity;
    private lastUpdate = 0;
    /** True while the budget is actively counting down (kernel appears stuck). */
    private charging = false;
    private readonly monitoring: Promise<void>;
    private stopped = false;
    private probing = false;
    /** Number of recovery probes attempted; also distinguishes `healthy` from `recovered`. */
    private attempts = 0;
    private failure?: Error;
    /** Guards `finalize()` so the telemetry report is emitted exactly once. */
    private reported = false;

    /** Cancellation token that fires when startup fails, times out, or completes/stops. */
    public get token() {
        return this.cancellation.token;
    }
    /** Remaining no-progress budget in ms (never negative); recomputed on read. */
    public get remainingTime() {
        this.updateBudget();
        return Math.max(0, this.remaining);
    }
    /** The failure/timeout/cancellation reason once startup has failed, otherwise undefined. */
    public get error() {
        return this.failure;
    }

    /**
     * @param timeout Total no-progress budget in ms. Startup fails only after the kernel has been
     *                unresponsive (not merely slow) for this cumulative duration.
     * @param timeoutError Error to raise when the budget is exhausted.
     * @param probe Opens a fresh peer and sends a signed `kernel_info_request` to nudge a stuck kernel.
     * @param report Optional telemetry sink invoked exactly once with the final outcome.
     */
    constructor(
        timeout: number,
        private readonly timeoutError: Error,
        private readonly probe: (token: CancellationToken) => Promise<void>,
        private readonly report?: (info: KernelStartupRecoveryReport) => void
    ) {
        this.failed.promise.catch(noop);
        this.remaining = timeout;
        this.interval = Math.max(1, Math.min(500, timeout / 2));
        this.lastUpdate = this.clock.elapsedTime;
        this.monitoring = this.monitor().catch((error) => {
            if (!this.stopped && !this.failure) {
                this.fail(error);
            }
        });
    }

    /** Record an outgoing shell request so the budget/monitor can tell if the kernel responds to it. */
    public sent(message: KernelMessage.IMessage) {
        if (this.stopped || message.channel !== 'shell' || !message.header.msg_type.endsWith('_request')) {
            return;
        }
        this.requests.set(message.header.msg_id, { reply: false, idle: false, acknowledged: false });
        this.notify();
    }

    /**
     * Record an incoming message against its originating request. A shell reply marks the request
     * replied; an IOPub busy/idle status marks it acknowledged and (on idle) complete. Any
     * acknowledgement counts as progress and pauses the no-progress budget.
     */
    public received(message: KernelMessage.IMessage) {
        if (this.stopped) {
            return;
        }
        const id = message.parent_header.msg_id;
        if (!id) {
            return;
        }
        const status =
            message.channel === 'iopub' &&
            message.header.msg_type === 'status' &&
            message.content &&
            'execution_state' in message.content
                ? message.content?.execution_state
                : undefined;
        if (status === 'idle') {
            this.auxiliary.delete(id);
        }
        const request = this.requests.get(id);
        if (request) {
            request.acknowledged = true;
            if (message.channel === 'shell') {
                request.reply = true;
            } else if (status) {
                request.idle = status === 'idle';
            }
            if (request.reply && request.idle) {
                this.requests.delete(id);
            }
        }
        this.notify();
    }

    /** A recovery probe request was sent; wait for its reply before declaring the kernel idle. */
    public auxiliarySent(id: string) {
        this.auxiliary.add(id);
        this.notify();
    }

    /** A recovery probe request received its matching reply. */
    public auxiliaryReplied(id: string) {
        this.auxiliary.delete(id);
        this.notify();
    }

    /** A recovery probe request could not be sent; stop waiting on it. */
    public auxiliaryNotSent(id: string) {
        this.auxiliary.delete(id);
        this.notify();
    }

    /**
     * Marks the point where real initialization starts. Requests tracked from earlier warm-up
     * attempts are discarded, because those can legitimately miss IOPub before the subscription is
     * ready and must not count against the budget or keep the monitor probing.
     */
    public beginInitialization() {
        this.check();
        this.requests.clear();
        this.notify();
    }

    /** Fail the startup with the given error, cancel the token, report telemetry, and wake waiters. */
    public fail(error: Error) {
        if (this.stopped || this.failure) {
            return;
        }
        this.failure = error;
        this.failed.reject(error);
        this.cancellation.cancel();
        this.finalize();
        this.notify();
    }

    /** Emit the telemetry report exactly once, classifying the outcome from the terminal state. */
    private finalize() {
        if (this.reported) {
            return;
        }
        this.reported = true;
        const outcome = this.failure
            ? this.failure === this.timeoutError
                ? 'timeout'
                : isCancellationError(this.failure)
                ? 'cancelled'
                : 'failed'
            : this.attempts > 0
            ? 'recovered'
            : 'healthy';
        this.report?.({ probeCount: this.attempts, durationMs: this.clock.elapsedTime, outcome });
    }

    /**
     * Runs the initialization `operation` under the recovery token, racing it against failure so a
     * budget timeout or cancellation unblocks it. The monitor probes concurrently while this runs.
     * Fails the recovery (and rethrows) if the parent cancels or the operation throws.
     */
    public async run<T>(operation: (token: CancellationToken) => Promise<T>, parent: CancellationToken): Promise<T> {
        if (parent.isCancellationRequested) {
            this.fail(new CancellationError());
        }
        const subscription = parent.onCancellationRequested(() => this.fail(new CancellationError()));
        try {
            this.check();
            const result = await Promise.race([operation(this.token), this.failed.promise]);
            this.check();
            return result;
        } catch (error) {
            this.fail(error);
            throw this.failure || error;
        } finally {
            subscription.dispose();
        }
    }

    /**
     * Finalizes readiness: waits for all tracked requests to settle, runs the fresh readiness check
     * `ready()`, then waits again. If a probe fired during the check, the kernel's state may have
     * changed, so it loops until a stable pass with no new probe attempts. Then stops the monitor.
     */
    public async complete(ready: () => Promise<unknown>, parent: CancellationToken) {
        await this.run(async () => {
            do {
                await this.waitForRequests();
                const attempts = this.attempts;
                await ready();
                await this.waitForRequests();
                if (attempts === this.attempts) {
                    break;
                }
            } while (true);
        }, parent);
        this.stop();
        await this.monitoring;
    }

    /** Blocks until there are no outstanding tracked requests, pending probes, or in-flight probe. */
    private async waitForRequests() {
        while (this.requests.size || this.auxiliary.size || this.probing) {
            const changed = this.changed.promise;
            this.check();
            await Promise.race([changed, this.failed.promise]);
        }
        this.check();
    }

    /**
     * Background loop that fires recovery probes while the kernel appears stuck. Every second it
     * re-evaluates: it skips while any request is acknowledged-but-busy (progress) or while nothing
     * is outstanding, and only probes once the kernel has been continuously eligible for at least
     * `interval` and the previous probe was at least `interval` ago (so a healthy-but-slow start is
     * never probed prematurely and probes stay spaced out).
     */
    private async monitor() {
        while (!this.stopped && !this.failure) {
            await this.wait(1000);
            this.check();
            this.updateBudget();
            if ([...this.requests.values()].some((request) => request.acknowledged && !request.idle)) {
                continue;
            }
            if (!this.requests.size && !this.auxiliary.size) {
                continue;
            }
            const now = this.clock.elapsedTime;
            if (
                this.eligibleSince === undefined ||
                now - this.eligibleSince < this.interval ||
                now - this.lastAttempt < this.interval
            ) {
                continue;
            }
            this.probing = true;
            this.attempts += 1;
            this.lastAttempt = now;
            try {
                await this.probe(this.token);
            } finally {
                this.probing = false;
                this.notify();
            }
        }
    }

    /** Sleeps up to `milliseconds`, resolving early (rejecting) if the recovery token is cancelled. */
    private async wait(milliseconds: number) {
        const deferred = createDeferred<void>();
        deferred.promise.catch(noop);
        const timer = setTimeout(() => deferred.resolve(), milliseconds);
        const subscription = this.token.onCancellationRequested(() =>
            deferred.reject(this.failure || new CancellationError())
        );
        try {
            this.check();
            await deferred.promise;
        } finally {
            clearTimeout(timer);
            subscription.dispose();
        }
    }

    /** Throws if startup has already failed, been stopped, or just exhausted its no-progress budget. */
    private check() {
        if (this.failure) {
            throw this.failure;
        }
        if (this.stopped) {
            throw new CancellationError();
        }
        if (this.remainingTime <= 0) {
            this.fail(this.timeoutError);
            throw this.timeoutError;
        }
    }

    /**
     * Recomputes the budget. Charges elapsed time only while "eligible" — i.e. the kernel has an
     * unacknowledged request (or a pending probe) and nothing acknowledged-but-busy. Tracks
     * `eligibleSince` so the monitor can require continuous no-progress before probing.
     */
    private updateBudget() {
        if (this.stopped || this.failure) {
            return;
        }
        const now = this.clock.elapsedTime;
        if (this.charging) {
            this.remaining -= Math.max(0, now - this.lastUpdate);
        }
        this.lastUpdate = now;
        const states = [...this.requests.values()];
        const pausedByAck = states.some((request) => request.acknowledged && !request.idle);
        const unacknowledged = states.some((request) => !request.acknowledged);
        const pendingAuxiliary = this.auxiliary.size > 0;
        const eligible = !pausedByAck && (unacknowledged || pendingAuxiliary);
        if (eligible && this.eligibleSince === undefined) {
            this.eligibleSince = now;
        } else if (!eligible) {
            this.eligibleSince = undefined;
        }
        this.charging = eligible;
    }

    /** Recomputes the budget and wakes anything waiting on a bookkeeping change. */
    private notify() {
        this.updateBudget();
        this.changed.resolve();
        this.changed = createDeferred<void>();
    }

    /** Successful terminal transition: stop monitoring, cancel the token, and report the outcome once. */
    private stop() {
        this.stopped = true;
        this.cancellation.cancel();
        this.finalize();
        this.notify();
    }

    /** Disposal before success is treated as a cancellation failure, then stopped. */
    public dispose() {
        if (!this.stopped) {
            this.fail(new CancellationError());
            this.stop();
        }
        this.cancellation.dispose();
    }
}
