// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { Kernel, KernelMessage } from '@jupyterlab/services';
import { JSONObject } from '@lumino/coreutils';
import { Observable } from 'rxjs/Observable';
import { CancellationToken, Event, EventEmitter } from 'vscode';
import { KernelConnectionMetadata } from '../../client/datascience/jupyter/kernels/types';
import {
    ICell,
    ICellHashProvider,
    IJupyterSession,
    INotebook,
    INotebookCompletion,
    INotebookProviderConnection,
    InterruptResult,
    KernelSocketInformation
} from '../../client/datascience/types';
import { PythonEnvironment } from '../../client/pythonEnvironments/info';
import { noop } from '../core';

/* eslint-disable @typescript-eslint/no-explicit-any */

export class MockJupyterNotebook implements INotebook {
    public get connection(): INotebookProviderConnection | undefined {
        return this.providerConnection;
    }
    public get onSessionStatusChanged(): Event<KernelMessage.Status> {
        return this.onStatusChangedEvent.event;
    }

    public get status(): KernelMessage.Status {
        return 'idle';
    }
    public get session(): IJupyterSession {
        throw new Error('Method not implemented');
    }

    public get onKernelInterrupted(): Event<void> {
        return this.kernelInterrupted.event;
    }
    public kernelSocket = new Observable<KernelSocketInformation | undefined>();
    public onKernelChanged = new EventEmitter<KernelConnectionMetadata>().event;
    public onDisposed = new EventEmitter<void>().event;
    public onKernelRestarted = new EventEmitter<void>().event;
    public readonly disposed: boolean = false;
    private kernelInterrupted = new EventEmitter<void>();
    private onStatusChangedEvent = new EventEmitter<KernelMessage.Status>();

    constructor(private providerConnection: INotebookProviderConnection | undefined) {
        noop();
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
    public registerIOPubListener(_listener: (msg: KernelMessage.IIOPubMessage, requestId: string) => void): void {
        noop();
    }
    public getCellHashProvider(): ICellHashProvider | undefined {
        throw new Error('Method not implemented.');
    }

    public clear(_id: string): void {
        noop();
    }
    public async runInitialSetup(): Promise<void> {
        noop();
    }
    public executeObservable(_code: string, _f: string, _line: number): Observable<ICell[]> {
        throw new Error('Method not implemented');
    }

    public inspect(_code: string, _offsetInCode = 0, _cancelToken?: CancellationToken): Promise<JSONObject> {
        return Promise.resolve({});
    }

    public async getCompletion(
        _cellCode: string,
        _offsetInCode: number,
        _cancelToken?: CancellationToken
    ): Promise<INotebookCompletion> {
        throw new Error('Method not implemented');
    }
    public execute(_code: string, _f: string, _line: number): Promise<ICell[]> {
        throw new Error('Method not implemented');
    }
    public restartKernel(): Promise<void> {
        throw new Error('Method not implemented');
    }
    public translateToNotebook(_cells: ICell[]): Promise<JSONObject> {
        throw new Error('Method not implemented');
    }
    public waitForIdle(): Promise<void> {
        throw new Error('Method not implemented');
    }
    public getSysInfo(): Promise<ICell | undefined> {
        return Promise.resolve(undefined);
    }

    public interruptKernel(_timeout: number): Promise<InterruptResult> {
        throw new Error('Method not implemented');
    }

    public async dispose(): Promise<void> {
        if (this.onStatusChangedEvent) {
            this.onStatusChangedEvent.dispose();
        }
        return Promise.resolve();
    }

    public getMatchingInterpreter(): PythonEnvironment | undefined {
        return;
    }

    public setInterpreter(_inter: PythonEnvironment) {
        noop();
    }

    public getKernelConnection(): KernelConnectionMetadata | undefined {
        return;
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
}
