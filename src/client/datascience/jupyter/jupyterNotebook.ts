// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { Event, EventEmitter, Uri } from 'vscode';
import '../../common/extensions';
import { traceError, traceInfo } from '../../common/logger';

import { IJupyterSession, INotebook, INotebookExecutionInfo } from '../types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
import cloneDeep = require('lodash/cloneDeep');

// This code is based on the examples here:
// https://www.npmjs.com/package/@jupyterlab/services

export class JupyterNotebookBase implements INotebook {
    private _disposed: boolean = false;
    private _executionInfo: INotebookExecutionInfo;
    public get onDisposed(): Event<void> {
        return this.disposedEvent.event;
    }
    public get disposed() {
        return this._disposed;
    }
    private disposedEvent = new EventEmitter<void>();
    public get session(): IJupyterSession {
        return this._session;
    }

    constructor(
        private readonly _session: IJupyterSession,
        executionInfo: INotebookExecutionInfo,
        private readonly identity: Uri
    ) {
        // Make a copy of the launch info so we can update it in this class
        this._executionInfo = cloneDeep(executionInfo);
    }

    public get connection() {
        return this._executionInfo.connectionInfo;
    }

    public async dispose(): Promise<void> {
        if (!this._disposed) {
            this._disposed = true;
            this.disposedEvent.fire();

            try {
                traceInfo(`Shutting down session ${this.identity.toString()}`);
                await this.session.dispose().catch(traceError.bind('Failed to dispose session from JupyterNotebook'));
            } catch (exc) {
                traceError(`Exception shutting down session `, exc);
            }
        }
    }
}
