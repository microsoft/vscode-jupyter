// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { Kernel, KernelMessage } from '@jupyterlab/services';
import { JSONObject } from '@lumino/coreutils';
import { CancellationTokenSource, Event, EventEmitter } from 'vscode';

import { Observable } from 'rxjs/Observable';
import { noop } from '../../client/common/utils/misc';
import { JupyterInvalidKernelError } from '../../client/datascience/errors/jupyterInvalidKernelError';
import { JupyterWaitForIdleError } from '../../client/datascience/errors/jupyterWaitForIdleError';
import { KernelConnectionMetadata } from '../../client/datascience/jupyter/kernels/types';
import { IJupyterSession, KernelSocketInformation } from '../../client/datascience/types';
import { sleep } from '../core';
import { MockJupyterRequest } from './mockJupyterRequest';
import { Resource } from '../../client/common/types';
import type * as nbformat from '@jupyterlab/nbformat';
import { concatMultilineString } from '../../datascience-ui/common';
import { KernelInterruptTimeoutError } from '../../client/datascience/errors/kernelInterruptTimeoutError';

const LineFeedRegEx = /(\r\n|\n)/g;

/* eslint-disable @typescript-eslint/no-explicit-any, , no-multi-str,  */
export class MockJupyterSession implements IJupyterSession {
    public readonly workingDirectory = '';
    private _isDisposed?: boolean;
    public readonly kernelSocket = new Observable<KernelSocketInformation | undefined>();
    private dict: Map<string, nbformat.IBaseCell>;
    private onStatusChangedEvent = new EventEmitter<KernelMessage.Status>();
    private timedelay: number;
    private executionCount: number = 0;
    private outstandingRequestTokenSources: CancellationTokenSource[] = [];
    private executes: string[] = [];
    private forceRestartTimeout: boolean = false;
    private completionTimeout: number = 1;
    private lastRequest: Kernel.IFuture<any, any> | undefined;
    private _status: KernelMessage.Status = 'busy';
    private _disposed = new EventEmitter<void>();
    public get onDidDispose() {
        return this._disposed.event;
    }
    public get disposed() {
        return this._isDisposed === true;
    }
    constructor(
        cellDictionary: Record<string, nbformat.IBaseCell> | nbformat.IBaseCell[],
        timedelay: number,
        private pendingIdleFailure: boolean = false,
        private pendingKernelChangeFailure: boolean = false
    ) {
        this.dict = new Map<string, nbformat.IBaseCell>();
        if (Array.isArray(cellDictionary)) {
            cellDictionary.forEach((cell) => {
                const source = concatMultilineString(cell.source);
                this.dict.set(source, cell);
            });
        } else {
            Object.keys(cellDictionary).forEach((key) => {
                this.dict.set(key, cellDictionary[key]);
            });
        }
        this.timedelay = timedelay;
        // Switch to idle after a timeout
        setTimeout(() => this.changeStatus('idle'), 100);
    }

    public shutdown(_force?: boolean): Promise<void> {
        this._isDisposed = true;
        this._disposed.fire();
        this._disposed.dispose();
        return Promise.resolve();
    }

    public get onSessionStatusChanged(): Event<KernelMessage.Status> {
        return this.onStatusChangedEvent.event;
    }
    public get onIOPubMessage(): Event<KernelMessage.IIOPubMessage> {
        return new EventEmitter<KernelMessage.IIOPubMessage>().event;
    }
    public get status(): KernelMessage.Status {
        return this._status;
    }

    public async restart(): Promise<void> {
        // For every outstanding request, switch them to fail mode
        const requests = [...this.outstandingRequestTokenSources];
        requests.forEach((r) => r.cancel());

        if (this.forceRestartTimeout) {
            throw new KernelInterruptTimeoutError(undefined as any);
        }

        return sleep(this.timedelay);
    }
    public interrupt(): Promise<void> {
        const requests = [...this.outstandingRequestTokenSources];
        requests.forEach((r) => r.cancel());
        return sleep(this.timedelay);
    }
    public waitForIdle(_timeout: number): Promise<void> {
        if (this.pendingIdleFailure) {
            this.pendingIdleFailure = false;
            return Promise.reject(new JupyterWaitForIdleError('Kernel is dead'));
        }
        return sleep(this.timedelay);
    }
    public async requestKernelInfo(): Promise<KernelMessage.IInfoReplyMsg | undefined> {
        return {
            channel: 'shell',
            content: {
                protocol_version: '',
                banner: '',
                language_info: {
                    name: 'py',
                    version: '3'
                },
                status: 'ok',
                implementation: '',
                implementation_version: '',
                help_links: []
            },
            header: {} as any,
            metadata: {} as any,
            parent_header: {} as any
        };
    }
    public prolongRestarts() {
        this.forceRestartTimeout = true;
    }
    public requestExecute(
        content: KernelMessage.IExecuteRequestMsg['content'],
        _disposeOnDone?: boolean,
        _metadata?: JSONObject
    ): Kernel.IFuture<any, any> {
        // Content should have the code
        const cell = this.findCell(content.code);
        if (cell) {
            this.executes.push(content.code);
        }

        // Create a new dummy request
        this.executionCount += content.store_history && content.code.trim().length > 0 ? 1 : 0;
        const tokenSource = new CancellationTokenSource();
        let request: Kernel.IFuture<any, any>;
        request = new MockJupyterRequest(cell, this.timedelay, this.executionCount, tokenSource.token);
        this.outstandingRequestTokenSources.push(tokenSource);

        // When it finishes, it should not be an outstanding request anymore
        const removeHandler = () => {
            this.outstandingRequestTokenSources = this.outstandingRequestTokenSources.filter((f) => f !== tokenSource);
            if (this.lastRequest === request) {
                this.lastRequest = undefined;
            }
        };
        request.done.then(removeHandler).catch(removeHandler);
        this.lastRequest = request;
        return request;
    }

    public requestDebug(
        _content: KernelMessage.IDebugRequestMsg['content'],
        _disposeOnDone?: boolean
    ): Kernel.IControlFuture<KernelMessage.IDebugRequestMsg, KernelMessage.IDebugReplyMsg> {
        throw new Error('Not implemented');
    }

    public requestInspect(
        _content: KernelMessage.IInspectRequestMsg['content']
    ): Promise<KernelMessage.IInspectReplyMsg> {
        return Promise.resolve({
            content: {
                status: 'ok',
                metadata: {},
                found: true,
                data: {} // Could add variable values here?
            },
            channel: 'shell',
            header: {
                date: 'foo',
                version: '1',
                session: '1',
                msg_id: '1',
                msg_type: 'inspect_reply',
                username: 'foo'
            },
            parent_header: {
                date: 'foo',
                version: '1',
                session: '1',
                msg_id: '1',
                msg_type: 'inspect_request',
                username: 'foo'
            },
            metadata: {}
        });
    }

    public sendInputReply(content: KernelMessage.IInputReply) {
        if (this.lastRequest) {
            this.lastRequest.sendInputReply(content);
        }
    }

    public async requestComplete(
        _content: KernelMessage.ICompleteRequestMsg['content']
    ): Promise<KernelMessage.ICompleteReplyMsg> {
        await sleep(this.completionTimeout);

        return {
            content: {
                matches: ['printly', '%%bash'], // This keeps this in the intellisense when the editor pairs down results
                cursor_start: 0,
                cursor_end: 7,
                status: 'ok',
                metadata: {}
            },
            channel: 'shell',
            header: {
                username: 'foo',
                version: '1',
                session: '1',
                msg_id: '1',
                msg_type: 'complete' as any,
                date: ''
            },
            parent_header: {},
            metadata: {}
        } as any;
    }

    public dispose(): Promise<void> {
        return sleep(10);
    }

    public getExecutes(): string[] {
        return this.executes;
    }

    public setCompletionTimeout(timeout: number) {
        this.completionTimeout = timeout;
    }

    public changeKernel(
        _resource: Resource,
        kernelConnection: KernelConnectionMetadata,
        _timeoutMS: number
    ): Promise<void> {
        if (this.pendingKernelChangeFailure) {
            this.pendingKernelChangeFailure = false;
            return Promise.reject(new JupyterInvalidKernelError(kernelConnection));
        }
        return Promise.resolve();
    }

    public registerCommTarget(
        _targetName: string,
        _callback: (comm: Kernel.IComm, msg: KernelMessage.ICommOpenMsg) => void | PromiseLike<void>
    ) {
        noop();
    }

    public registerMessageHook(
        _msgId: string,
        _hook: (msg: KernelMessage.IIOPubMessage) => boolean | PromiseLike<boolean>
    ): void {
        noop();
    }
    public removeMessageHook(
        _msgId: string,
        _hook: (msg: KernelMessage.IIOPubMessage) => boolean | PromiseLike<boolean>
    ): void {
        noop();
    }

    private changeStatus(newStatus: KernelMessage.Status) {
        this._status = newStatus;
        this.onStatusChangedEvent.fire(newStatus);
    }

    private findCell = (code: string): nbformat.IBaseCell => {
        // Match skipping line separators
        const withoutLines = code.replace(LineFeedRegEx, '').toLowerCase();

        if (this.dict.has(withoutLines)) {
            return this.dict.get(withoutLines)!;
        }
        // eslint-disable-next-line no-console
        console.log(`Cell '${code}' not found in mock`);
        // eslint-disable-next-line no-console
        console.log(`Dict has these keys ${Object.keys(this.dict).join('","')}`);
        throw new Error(`Cell '${code}' not found in mock`);
    };
}
