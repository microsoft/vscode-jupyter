// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { KernelMessage } from '@jupyterlab/services';
import { CancellationError, CancellationToken, CancellationTokenSource } from 'vscode';
import { createDeferred } from '../platform/common/utils/async';
import { isCancellationError } from '../platform/common/cancellation';
import { noop } from '../platform/common/utils/misc';
import { StopWatch } from '../platform/common/utils/stopWatch';
import { IKernelStartup } from './types';

export class KernelStartupRecovery implements IKernelStartup {
    private readonly clock = new StopWatch();
    private readonly cancellation = new CancellationTokenSource();
    private readonly failed = createDeferred<never>();
    private changed = createDeferred<void>();
    private readonly requests = new Map<string, { reply: boolean; idle: boolean; acknowledged: boolean }>();
    private readonly auxiliary = new Set<string>();
    private remaining: number;
    private readonly interval: number;
    private eligibleSince?: number;
    private lastAttempt = -Infinity;
    private lastUpdate = 0;
    private charging = false;
    private readonly monitoring: Promise<void>;
    private stopped = false;
    private probing = false;
    private attempts = 0;
    private failure?: Error;
    private reported = false;

    public get token() {
        return this.cancellation.token;
    }
    public get remainingTime() {
        this.updateBudget();
        return Math.max(0, this.remaining);
    }
    public get error() {
        return this.failure;
    }

    constructor(
        timeout: number,
        private readonly timeoutError: Error,
        private readonly probe: (token: CancellationToken) => Promise<void>,
        private readonly report?: (info: {
            probeCount: number;
            durationMs: number;
            outcome: 'healthy' | 'recovered' | 'timeout' | 'cancelled' | 'failed';
        }) => void
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

    public sent(message: KernelMessage.IMessage) {
        if (this.stopped || message.channel !== 'shell' || !message.header.msg_type.endsWith('_request')) {
            return;
        }
        this.requests.set(message.header.msg_id, { reply: false, idle: false, acknowledged: false });
        this.notify();
    }

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

    public auxiliarySent(id: string) {
        this.auxiliary.add(id);
        this.notify();
    }

    public auxiliaryReplied(id: string) {
        this.auxiliary.delete(id);
        this.notify();
    }

    public auxiliaryNotSent(id: string) {
        this.auxiliary.delete(id);
        this.notify();
    }

    public beginInitialization() {
        this.check();
        // Earlier warm-up attempts can legitimately miss IOPub before subscription is ready.
        this.requests.clear();
        this.notify();
    }

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

    private async waitForRequests() {
        while (this.requests.size || this.auxiliary.size || this.probing) {
            const changed = this.changed.promise;
            this.check();
            await Promise.race([changed, this.failed.promise]);
        }
        this.check();
    }

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

    private notify() {
        this.updateBudget();
        this.changed.resolve();
        this.changed = createDeferred<void>();
    }

    private stop() {
        this.stopped = true;
        this.cancellation.cancel();
        this.finalize();
        this.notify();
    }

    public dispose() {
        if (!this.stopped) {
            this.fail(new CancellationError());
            this.stop();
        }
        this.cancellation.dispose();
    }
}
