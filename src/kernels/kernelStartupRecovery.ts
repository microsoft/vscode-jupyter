// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Kernel, KernelMessage } from '@jupyterlab/services';
import { CancellationError, CancellationToken, Event } from 'vscode';
import { createDeferred } from '../platform/common/utils/async';
import { isCancellationError, wrapCancellationTokens } from '../platform/common/cancellation';
import { IDisposable } from '../platform/common/types';
import { dispose } from '../platform/common/utils/lifecycle';
import { noop } from '../platform/common/utils/misc';
import { logger } from '../platform/logging';
import { KernelConnectionTimeoutError } from './errors/kernelConnectionTimeoutError';
import { IRawKernelStartupRecovery, KernelConnectionMetadata } from './types';

type RequestState = { acknowledged: boolean; replied: boolean; idle: boolean };
type RecoveryRequestState = RequestState & { submitted: boolean; closed: boolean };
export type StartupRecoveryRequestEvent = {
    requestId: string;
    phase: 'created' | 'sent' | 'reply' | 'closed';
};

export class KernelStartupRecovery implements IRawKernelStartupRecovery {
    private readonly failed = createDeferred<never>();
    public readonly failure = this.failed.promise;
    private readonly requests = new Map<string, RequestState>();
    private readonly auxiliary = new Map<string, RecoveryRequestState>();
    private workChanged = createDeferred<void>();
    private auxiliarySequence = 0;
    private readonly subscriptions: IDisposable[] = [];
    private remaining: number;
    private lastUpdate = performance.now();
    private charging = false;
    private eligibleSince?: number;
    private lastAttempt = -Infinity;
    private timer?: ReturnType<typeof setTimeout>;
    private probe?: Promise<void>;
    private probeHasRequest = false;
    private probeCancellation?: ReturnType<typeof wrapCancellationTokens>;
    private error?: Error;
    private stopped = false;
    private readonly interval: number;

    constructor(
        private readonly kernel: Kernel.IKernelConnection,
        posted: Event<KernelMessage.IMessage>,
        budget: number,
        private readonly token: CancellationToken,
        private readonly recover: (
            token: CancellationToken,
            timeout: number,
            observe: (event: StartupRecoveryRequestEvent) => void
        ) => Promise<void>,
        private readonly current: () => boolean,
        private readonly metadata: KernelConnectionMetadata
    ) {
        this.remaining = Math.max(0, budget);
        this.interval = Math.max(1, Math.min(500, this.remaining / 2));
        this.failure.catch(noop);
        this.subscriptions.push(posted(this.onPosted, this));
        this.kernel.anyMessage.connect(this.onMessage, this);
        this.subscriptions.push({
            dispose: () => {
                this.kernel.anyMessage.disconnect(this.onMessage, this);
            }
        });
        token.onCancellationRequested(() => this.abort(new CancellationError()), undefined, this.subscriptions);
        this.check();
    }

    public get remainingBudget() {
        this.updateBudget();
        return Math.max(0, this.remaining);
    }

    public isCurrent() {
        return this.current();
    }

    public throwIfFailed() {
        if (!this.stopped) {
            this.updateBudget();
            if (this.remaining <= 0) {
                this.abort(new KernelConnectionTimeoutError(this.metadata));
            }
        }
        if (this.error) {
            throw this.error;
        }
        if (this.token.isCancellationRequested || !this.current()) {
            throw new CancellationError();
        }
    }

    public abort(error: Error) {
        if (this.error || this.stopped) {
            return;
        }
        this.error = error;
        this.failed.reject(error);
        this.dispose();
    }

    public async finish(ready?: () => Promise<void>) {
        while (true) {
            await this.drain();
            const sequence = this.auxiliarySequence;
            if (!ready || sequence === 0) {
                return;
            }
            // A fresh primary barrier must follow all auxiliary work, not overtake a different peer.
            await Promise.race([ready(), this.failure]);
            await this.drain();
            if (sequence === this.auxiliarySequence) {
                return;
            }
        }
    }

    private async drain() {
        this.throwIfFailed();
        while (!this.stopped && (this.probe || this.auxiliary.size)) {
            await Promise.race([this.workChanged.promise, this.failure]);
            this.throwIfFailed();
        }
    }

    public async waitForIdle() {
        this.throwIfFailed();
        const idle = createDeferred<void>();
        const changed = (_kernel: Kernel.IKernelConnection, status: Kernel.Status) => {
            if (status === 'idle') {
                idle.resolve();
            }
        };
        this.kernel.statusChanged.connect(changed);
        try {
            if (this.kernel.status === 'idle') {
                idle.resolve();
            }
            // Acknowledged busy work does not consume a fresh absolute idle timeout.
            await Promise.race([idle.promise, this.failure]);
            this.throwIfFailed();
        } finally {
            this.kernel.statusChanged.disconnect(changed);
        }
    }

    public dispose() {
        if (this.stopped) {
            return;
        }
        this.stopped = true;
        this.charging = false;
        clearTimeout(this.timer);
        this.probeCancellation?.cancel();
        dispose(this.subscriptions);
        this.requests.clear();
        this.auxiliary.clear();
        this.notifyWorkChanged();
    }

    private onPosted(message: KernelMessage.IMessage) {
        if (
            this.stopped ||
            !this.current() ||
            message.channel !== 'shell' ||
            !message.header.msg_type.endsWith('_request')
        ) {
            return;
        }
        this.updateBudget();
        this.requests.set(message.header.msg_id, { acknowledged: false, replied: false, idle: false });
        this.updateBudget();
    }

    private onMessage(_kernel: Kernel.IKernelConnection, event: Kernel.IAnyMessageArgs) {
        if (this.stopped || event.direction !== 'recv') {
            return;
        }
        const message = event.msg;
        const id = message.parent_header.msg_id || '';
        const auxiliary = this.auxiliary.get(id);
        const request = auxiliary || this.requests.get(id);
        if (!request || (auxiliary && message.channel !== 'iopub')) {
            return;
        }
        this.updateBudget();
        request.acknowledged = true;
        if (message.channel === 'shell' && message.header.msg_type.endsWith('_reply')) {
            request.replied = true;
        }
        if (
            message.channel === 'iopub' &&
            message.header.msg_type === 'status' &&
            'execution_state' in message.content &&
            message.content.execution_state === 'idle'
        ) {
            request.idle = true;
        }
        if (!auxiliary && request.replied && request.idle) {
            this.requests.delete(id);
        }
        if (auxiliary) {
            this.retireAuxiliary(id, auxiliary);
        }
        this.updateBudget();
        this.notifyWorkChanged();
    }

    private onRecoveryRequest(event: StartupRecoveryRequestEvent) {
        if (this.stopped || !this.current()) {
            return;
        }
        this.updateBudget();
        if (event.phase === 'created') {
            this.probeHasRequest = true;
            this.auxiliarySequence += 1;
            this.auxiliary.set(event.requestId, {
                acknowledged: false,
                replied: false,
                idle: false,
                submitted: false,
                closed: false
            });
        } else {
            const request = this.auxiliary.get(event.requestId);
            if (request) {
                if (event.phase === 'sent') {
                    request.submitted = true;
                } else if (event.phase === 'reply') {
                    request.acknowledged = true;
                    request.replied = true;
                } else {
                    request.closed = true;
                }
                this.retireAuxiliary(event.requestId, request);
            }
        }
        this.updateBudget();
        this.notifyWorkChanged();
    }

    private retireAuxiliary(id: string, request: RecoveryRequestState) {
        if ((request.closed && !request.submitted) || (request.idle && (request.replied || request.closed))) {
            this.auxiliary.delete(id);
        }
    }

    private notifyWorkChanged() {
        this.workChanged.resolve();
        this.workChanged = createDeferred<void>();
    }

    private updateBudget() {
        if (this.stopped) {
            return;
        }
        const now = performance.now();
        if (this.charging) {
            this.remaining -= Math.max(0, now - this.lastUpdate);
        }
        this.lastUpdate = now;
        const states = [...this.requests.values(), ...this.auxiliary.values()];
        const paused = states.some((request) => request.acknowledged && !request.idle) || this.kernel.hasPendingInput;
        const eligible = [...this.requests.values()].some((request) => !request.acknowledged) && !paused;
        if (eligible && this.eligibleSince === undefined) {
            this.eligibleSince = now;
        } else if (!eligible) {
            this.eligibleSince = undefined;
        }
        this.charging =
            !paused &&
            (states.some((request) => !request.acknowledged) ||
                [...this.auxiliary.values()].some((request) => request.idle && !request.replied) ||
                (!!this.probe && !this.probeHasRequest));
    }

    private check() {
        if (this.stopped) {
            return;
        }
        if (this.token.isCancellationRequested || !this.current()) {
            this.abort(new CancellationError());
            return;
        }
        this.updateBudget();
        if (this.remaining <= 0) {
            logger.warn('Raw kernel startup made no progress before its communication budget expired');
            this.abort(new KernelConnectionTimeoutError(this.metadata));
            return;
        }
        const now = performance.now();
        if (
            this.eligibleSince !== undefined &&
            now - this.eligibleSince >= this.interval &&
            now - this.lastAttempt >= this.interval &&
            !this.probe
        ) {
            this.lastAttempt = now;
            const cancellation = wrapCancellationTokens(this.token);
            this.probeCancellation = cancellation;
            this.probeHasRequest = false;
            this.probe = Promise.resolve()
                .then(() => {
                    this.throwIfFailed();
                    return this.recover(
                        cancellation.token,
                        Math.max(1, Math.floor(Math.min(1000, this.remaining))),
                        (event) => this.onRecoveryRequest(event)
                    );
                })
                .catch((error: unknown) => {
                    if (
                        !cancellation.token.isCancellationRequested &&
                        !(error instanceof Error && isCancellationError(error)) &&
                        !this.stopped
                    ) {
                        logger.warn('Failed to wake the raw kernel during startup', error);
                    }
                })
                .finally(() => {
                    this.updateBudget();
                    cancellation.dispose();
                    this.probeCancellation = undefined;
                    this.probe = undefined;
                    this.updateBudget();
                    this.notifyWorkChanged();
                });
        }
        this.timer = setTimeout(() => this.check(), Math.max(1, Math.min(100, this.remaining)));
    }
}
