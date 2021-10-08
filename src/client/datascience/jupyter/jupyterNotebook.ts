// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import type { Kernel, KernelMessage } from '@jupyterlab/services';
import type { JSONObject } from '@lumino/coreutils';
import { Observable } from 'rxjs/Observable';
import * as path from 'path';
import { Disposable, Event, EventEmitter, Uri } from 'vscode';
import { CancellationToken } from 'vscode-jsonrpc';
import { ServerStatus } from '../../../datascience-ui/interactive-common/mainState';
import { IWorkspaceService } from '../../common/application/types';
import { CancellationError, createPromiseFromCancellation } from '../../common/cancellation';
import '../../common/extensions';
import { traceError, traceInfo, traceInfoIf } from '../../common/logger';

import { IDisposableRegistry, Resource } from '../../common/types';
import { createDeferred } from '../../common/utils/async';
import * as localize from '../../common/utils/localize';
import { CodeSnippets } from '../constants';
import {
    ICell,
    IJupyterSession,
    INotebook,
    INotebookCompletion,
    INotebookExecutionInfo,
    KernelSocketInformation
} from '../types';
import { expandWorkingDir } from './jupyterUtils';
import { KernelConnectionMetadata } from './kernels/types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
import cloneDeep = require('lodash/cloneDeep');
import { IFileSystem } from '../../common/platform/types';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { getInterpreterFromKernelConnectionMetadata, isPythonKernelConnection } from './kernels/helpers';
import { executeSilently } from './kernels/kernel';
import { isCI } from '../../common/constants';

// This code is based on the examples here:
// https://www.npmjs.com/package/@jupyterlab/services

export class JupyterNotebookBase implements INotebook {
    private _resource: Resource;
    private _identity: Uri;
    private _disposed: boolean = false;
    private _workingDirectory: string | undefined;
    private _executionInfo: INotebookExecutionInfo;
    private onStatusChangedEvent: EventEmitter<ServerStatus> | undefined;
    public get onDisposed(): Event<void> {
        return this.disposedEvent.event;
    }
    public get onDidFinishExecuting(): Event<ICell> {
        return this.finishedExecuting.event;
    }
    public get disposed() {
        return this._disposed;
    }
    public get onKernelRestarted(): Event<void> {
        return this.kernelRestarted.event;
    }
    private readonly kernelRestarted = new EventEmitter<void>();
    private disposedEvent = new EventEmitter<void>();
    private finishedExecuting = new EventEmitter<ICell>();
    private sessionStatusChanged: Disposable | undefined;
    public get kernelSocket(): Observable<KernelSocketInformation | undefined> {
        return this.session.kernelSocket;
    }
    public get session(): IJupyterSession {
        return this._session;
    }

    constructor(
        private readonly _session: IJupyterSession,
        private disposableRegistry: IDisposableRegistry,
        executionInfo: INotebookExecutionInfo,
        resource: Resource,
        identity: Uri,
        private workspace: IWorkspaceService,
        private fs: IFileSystem
    ) {
        const statusChangeHandler = (status: ServerStatus) => {
            if (this.onStatusChangedEvent) {
                this.onStatusChangedEvent.fire(status);
            }
        };
        this.sessionStatusChanged = this.session.onSessionStatusChanged(statusChangeHandler);
        this._identity = identity;
        this._resource = resource;

        // Make a copy of the launch info so we can update it in this class
        this._executionInfo = cloneDeep(executionInfo);
    }

    public get connection() {
        return this._executionInfo.connectionInfo;
    }

    public async dispose(): Promise<void> {
        if (!this._disposed) {
            this._disposed = true;
            if (this.onStatusChangedEvent) {
                this.onStatusChangedEvent.dispose();
                this.onStatusChangedEvent = undefined;
            }
            if (this.sessionStatusChanged) {
                this.sessionStatusChanged.dispose();
                this.onStatusChangedEvent = undefined;
            }
            this.disposedEvent.fire();

            try {
                traceInfo(`Shutting down session ${this.identity.toString()}`);
                await this.session.dispose().catch(traceError.bind('Failed to dispose session from JupyterNotebook'));
            } catch (exc) {
                traceError(`Exception shutting down session `, exc);
            }
        }
    }
    public async requestKernelInfo(): Promise<KernelMessage.IInfoReplyMsg | undefined> {
        return this.session.requestKernelInfo();
    }
    public get onSessionStatusChanged(): Event<ServerStatus> {
        if (!this.onStatusChangedEvent) {
            this.onStatusChangedEvent = new EventEmitter<ServerStatus>();
        }
        return this.onStatusChangedEvent.event;
    }

    public get status(): ServerStatus {
        return this.session.status;
    }

    public get resource(): Resource {
        return this._resource;
    }
    public get identity(): Uri {
        return this._identity;
    }

    public waitForIdle(timeoutMs: number): Promise<void> {
        return this.session.waitForIdle(timeoutMs);
    }
    public inspect(code: string, offsetInCode = 0, cancelToken?: CancellationToken): Promise<JSONObject> {
        // Create a deferred that will fire when the request completes
        const deferred = createDeferred<JSONObject>();

        // First make sure still valid.
        const exitError = this.checkForExit();
        if (exitError) {
            // Not running, just exit
            deferred.reject(exitError);
        } else {
            try {
                // Ask session for inspect result
                this.session
                    .requestInspect({ code, cursor_pos: offsetInCode, detail_level: 0 })
                    .then((r) => {
                        if (r && r.content.status === 'ok') {
                            deferred.resolve(r.content.data);
                        } else {
                            deferred.resolve(undefined);
                        }
                    })
                    .catch((ex) => {
                        deferred.reject(ex);
                    });
            } catch (ex) {
                deferred.reject(ex);
            }
        }

        if (cancelToken) {
            this.disposableRegistry.push(
                cancelToken.onCancellationRequested(() => deferred.reject(new CancellationError()))
            );
        }

        return deferred.promise;
    }

    public setLaunchingFile(file: string): Promise<void> {
        // Update our working directory if we don't have one set already
        return this.updateWorkingDirectoryAndPath(file);
    }

    public fireRestart() {
        this.kernelRestarted.fire();
    }
    public async getCompletion(
        cellCode: string,
        offsetInCode: number,
        cancelToken?: CancellationToken
    ): Promise<INotebookCompletion> {
        // If server is busy, then don't delay code completion.
        if (this.session.status === ServerStatus.Busy) {
            return {
                matches: [],
                cursor: { start: 0, end: 0 },
                metadata: {}
            };
        }
        const result = await Promise.race([
            this.session.requestComplete({
                code: cellCode,
                cursor_pos: offsetInCode
            }),
            createPromiseFromCancellation({ defaultValue: undefined, cancelAction: 'resolve', token: cancelToken })
        ]);
        traceInfoIf(
            isCI,
            `Got jupyter notebook completions. Is cancel? ${cancelToken?.isCancellationRequested}: ${
                result ? JSON.stringify(result) : 'empty'
            }`
        );
        if (result && result.content) {
            if ('matches' in result.content) {
                return {
                    matches: result.content.matches,
                    cursor: {
                        start: result.content.cursor_start,
                        end: result.content.cursor_end
                    },
                    metadata: result.content.metadata
                };
            }
        }
        return {
            matches: [],
            cursor: { start: 0, end: 0 },
            metadata: {}
        };
    }

    public getMatchingInterpreter(): PythonEnvironment | undefined {
        return getInterpreterFromKernelConnectionMetadata(this.getKernelConnection()) as PythonEnvironment | undefined;
    }

    public getKernelConnection(): KernelConnectionMetadata | undefined {
        return this._executionInfo.kernelConnectionMetadata;
    }
    public registerCommTarget(
        targetName: string,
        callback: (comm: Kernel.IComm, msg: KernelMessage.ICommOpenMsg) => void | PromiseLike<void>
    ) {
        this.session.registerCommTarget(targetName, callback);
    }
    public registerMessageHook(
        msgId: string,
        hook: (msg: KernelMessage.IIOPubMessage) => boolean | PromiseLike<boolean>
    ): void {
        return this.session.registerMessageHook(msgId, hook);
    }
    public removeMessageHook(
        msgId: string,
        hook: (msg: KernelMessage.IIOPubMessage) => boolean | PromiseLike<boolean>
    ): void {
        return this.session.removeMessageHook(msgId, hook);
    }

    private async updateWorkingDirectoryAndPath(launchingFile?: string): Promise<void> {
        traceInfo('UpdateWorkingDirectoryAndPath in Jupyter Notebook');
        if (this._executionInfo && this._executionInfo.connectionInfo.localLaunch && !this._workingDirectory) {
            // See what our working dir is supposed to be
            const suggested = this._executionInfo.workingDir;
            if (suggested && (await this.fs.localDirectoryExists(suggested))) {
                // We should use the launch info directory. It trumps the possible dir
                this._workingDirectory = suggested;
                return this.changeDirectoryIfPossible(this._workingDirectory);
            } else if (
                launchingFile &&
                (await this.fs.localFileExists(launchingFile)) &&
                (await this.fs.localDirectoryExists(path.dirname(launchingFile)))
            ) {
                // Combine the working directory with this file if possible.
                this._workingDirectory = expandWorkingDir(
                    this._executionInfo.workingDir,
                    launchingFile,
                    this.workspace
                );
                if (this._workingDirectory) {
                    return this.changeDirectoryIfPossible(this._workingDirectory);
                }
            }
        }
    }

    // Update both current working directory and sys.path with the desired directory
    private changeDirectoryIfPossible = async (directory: string): Promise<void> => {
        if (
            this._executionInfo &&
            this._executionInfo.connectionInfo.localLaunch &&
            isPythonKernelConnection(this._executionInfo.kernelConnectionMetadata) &&
            (await this.fs.localDirectoryExists(directory))
        ) {
            traceInfo('changeDirectoryIfPossible');
            await executeSilently(this.session, CodeSnippets.UpdateCWDAndPath.format(directory));
        }
    };

    private checkForExit(): Error | undefined {
        if (this._executionInfo && this._executionInfo.connectionInfo && !this._executionInfo.connectionInfo.valid) {
            if (this._executionInfo.connectionInfo.type === 'jupyter') {
                // Not running, just exit
                if (this._executionInfo.connectionInfo.localProcExitCode) {
                    const exitCode = this._executionInfo.connectionInfo.localProcExitCode;
                    traceError(`Jupyter crashed with code ${exitCode}`);
                    return new Error(localize.DataScience.jupyterServerCrashed().format(exitCode.toString()));
                }
            }
        }
    }
}
