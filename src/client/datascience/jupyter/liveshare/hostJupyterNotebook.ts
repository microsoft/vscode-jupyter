// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { Observable } from 'rxjs/Observable';
import * as vscode from 'vscode';
import { IApplicationShell, IVSCodeNotebook, IWorkspaceService } from '../../../common/application/types';
import '../../../common/extensions';

import { IConfigurationService, IDisposableRegistry, Resource } from '../../../common/types';
import { LiveShare } from '../../constants';
import {
    ICell,
    IJupyterSession,
    INotebook,
    INotebookExecutionInfo,
    INotebookExecutionLogger,
    InterruptResult
} from '../../types';
import { JupyterNotebookBase } from '../jupyterNotebook';
import { IRoleBasedObject } from './roleBasedFactory';

import { IFileSystem } from '../../../common/platform/types';
import { IPythonExecutionFactory } from '../../../common/process/types';

/* eslint-disable @typescript-eslint/no-explicit-any */

export class HostJupyterNotebook extends JupyterNotebookBase implements IRoleBasedObject, INotebook {
    private requestLog: Map<string, number> = new Map<string, number>();
    private isDisposed = false;
    // eslint-disable-next-line @typescript-eslint/no-useless-constructor
    constructor(
        session: IJupyterSession,
        configService: IConfigurationService,
        disposableRegistry: IDisposableRegistry,
        executionInfo: INotebookExecutionInfo,
        loggers: INotebookExecutionLogger[],
        resource: Resource,
        identity: vscode.Uri,
        getDisposedError: () => Error,
        workspace: IWorkspaceService,
        appService: IApplicationShell,
        fs: IFileSystem,
        vscNotebook: IVSCodeNotebook,
        executionFactory: IPythonExecutionFactory
    ) {
        super(
            session,
            configService,
            disposableRegistry,
            executionInfo,
            loggers,
            resource,
            identity,
            getDisposedError,
            workspace,
            appService,
            fs,
            vscNotebook,
            executionFactory
        );
    }

    public dispose = async (): Promise<void> => {
        if (!this.isDisposed) {
            this.isDisposed = true;
            await super.dispose();
        }
    };
    public clear(id: string): void {
        this.requestLog.delete(id);
    }

    public executeObservable(
        code: string,
        file: string,
        line: number,
        id: string,
        silent?: boolean
    ): Observable<ICell[]> {
        return this.makeObservableRequest(code, file, line, id, silent);
    }

    public async restartKernel(timeoutMs: number): Promise<void> {
        try {
            await super.restartKernel(timeoutMs);
        } catch (exc) {
            throw exc;
        }
    }

    public async interruptKernel(timeoutMs: number): Promise<InterruptResult> {
        try {
            return super.interruptKernel(timeoutMs);
        } catch (exc) {
            throw exc;
        }
    }

    private makeObservableRequest(
        code: string,
        file: string,
        line: number,
        id: string,
        silent: boolean | undefined
    ): Observable<ICell[]> {
        try {
            this.requestLog.set(id, Date.now());
            const inner = super.executeObservable(code, file, line, id, silent);

            // Cleanup old requests
            const now = Date.now();
            for (const [k, val] of this.requestLog) {
                if (now - val > LiveShare.ResponseLifetime) {
                    this.requestLog.delete(k);
                }
            }

            return inner;
        } catch (exc) {
            throw exc;
        }
    }
}
