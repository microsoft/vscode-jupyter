// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { EventEmitter, NotebookDocument, Uri } from 'vscode';
import * as fs from 'fs-extra';
import { IControllerRegistration, type IVSCodeNotebookController } from './controllers/types';
import { IKernelProvider, isRemoteConnection, type IKernel } from '../kernels/types';
import { DisposableBase } from '../platform/common/utils/lifecycle';
import { isPythonKernelConnection } from '../kernels/helpers';
import { logger } from '../platform/logging';
import { getDisplayPath } from '../platform/common/platform/fs-paths.node';
import { noop } from '../platform/common/utils/misc';
import { INotebookEditorProvider, INotebookPythonEnvironmentService } from './types';
import { getCachedEnvironment, getInterpreterInfo } from '../platform/interpreter/helpers';
import type { Environment } from '@vscode/python-extension';
import type { PythonEnvironment } from '../platform/pythonEnvironments/info';

@injectable()
export class NotebookPythonEnvironmentService extends DisposableBase implements INotebookPythonEnvironmentService {
    private readonly _onDidChangeEnvironment = this._register(new EventEmitter<Uri>());
    public readonly onDidChangeEnvironment = this._onDidChangeEnvironment.event;

    private readonly notebookWithRemoteKernelsToMonitor = new WeakSet<NotebookDocument>();
    private readonly notebookPythonEnvironments = new WeakMap<NotebookDocument, Environment | undefined>();
    constructor(
        @inject(IControllerRegistration) private readonly controllerRegistration: IControllerRegistration,
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(INotebookEditorProvider) private readonly notebookEditorProvider: INotebookEditorProvider
    ) {
        super();
        this.monitorRemoteKernelStart();
        this._register(
            this.controllerRegistration.onControllerSelected((e) => {
                if (!isPythonKernelConnection(e.controller.connection)) {
                    this.notebookWithRemoteKernelsToMonitor.delete(e.notebook);
                    if (this.notebookPythonEnvironments.has(e.notebook)) {
                        this.notebookPythonEnvironments.delete(e.notebook);
                        this._onDidChangeEnvironment.fire(e.notebook.uri);
                    }
                    return;
                }

                if (isRemoteConnection(e.controller.connection)) {
                    this.notebookWithRemoteKernelsToMonitor.add(e.notebook);
                } else {
                    this.notebookWithRemoteKernelsToMonitor.delete(e.notebook);
                    this.notifyLocalPythonEnvironment(e.notebook, e.controller);
                }
            })
        );
    }

    public getPythonEnvironment(uri: Uri): Environment | undefined {
        const notebook = this.notebookEditorProvider.findAssociatedNotebookDocument(uri);
        return notebook ? this.notebookPythonEnvironments.get(notebook) : undefined;
    }

    private monitorRemoteKernelStart() {
        const trackKernel = async (e: IKernel) => {
            if (
                !this.notebookWithRemoteKernelsToMonitor.has(e.notebook) ||
                !isRemoteConnection(e.kernelConnectionMetadata) ||
                !isPythonKernelConnection(e.kernelConnectionMetadata)
            ) {
                return;
            }

            try {
                const env = await this.resolveRemotePythonEnvironment(e.notebook);
                if (this.controllerRegistration.getSelected(e.notebook)?.controller !== e.controller) {
                    logger.trace(
                        `Remote Python Env for ${getDisplayPath(e.notebook.uri)} not determined as controller changed`
                    );
                    return;
                }

                if (!env) {
                    logger.trace(
                        `Remote Python Env for ${getDisplayPath(e.notebook.uri)} not determined as exe is empty`
                    );
                    return;
                }

                this.notebookPythonEnvironments.set(e.notebook, env);
                this._onDidChangeEnvironment.fire(e.notebook.uri);
            } catch (ex) {
                logger.error(`Failed to get Remote Python Env for ${getDisplayPath(e.notebook.uri)}`, ex);
            }
        };
        this._register(this.kernelProvider.onDidCreateKernel(trackKernel));
        this._register(this.kernelProvider.onDidStartKernel(trackKernel));
    }

    private notifyLocalPythonEnvironment(notebook: NotebookDocument, controller: IVSCodeNotebookController) {
        // Empty string is special, means do not use any interpreter at all.
        // Could be a server started for local machine, github codespaces, azml, 3rd party api, etc
        const connection = this.kernelProvider.get(notebook)?.kernelConnectionMetadata || controller.connection;
        const interpreter = connection.interpreter;
        if (!isPythonKernelConnection(connection) || isRemoteConnection(connection) || !interpreter) {
            return;
        }

        const env = getCachedEnvironment(interpreter);
        if (env) {
            this.notebookPythonEnvironments.set(notebook, env);
            this._onDidChangeEnvironment.fire(notebook.uri);
            return;
        }

        void this.resolveAndNotifyLocalPythonEnvironment(notebook, controller, interpreter);
    }

    private async resolveAndNotifyLocalPythonEnvironment(
        notebook: NotebookDocument,
        controller: IVSCodeNotebookController,
        interpreter: PythonEnvironment | Readonly<PythonEnvironment>
    ) {
        const env = await getInterpreterInfo(interpreter);

        if (!env) {
            logger.error(
                `Failed to get interpreter information for ${getDisplayPath(notebook.uri)} && ${getDisplayPath(
                    interpreter.uri
                )}`
            );
            return;
        }

        if (this.controllerRegistration.getSelected(notebook)?.controller !== controller.controller) {
            logger.trace(`Python Env for ${getDisplayPath(notebook.uri)} not determined as controller changed`);
            return;
        }

        this.notebookPythonEnvironments.set(notebook, env);
        this._onDidChangeEnvironment.fire(notebook.uri);
    }

    private async resolveRemotePythonEnvironment(notebook: NotebookDocument): Promise<Environment | undefined> {
        // Empty string is special, means do not use any interpreter at all.
        // Could be a server started for local machine, github codespaces, azml, 3rd party api, etc
        const kernel = this.kernelProvider.get(notebook);
        if (!kernel) {
            return;
        }
        if (!kernel.startedAtLeastOnce) {
            return;
        }
        const execution = this.kernelProvider.getKernelExecution(kernel);
        const code = `
import os as _VSCODE_os
import sys as _VSCODE_sys
import builtins as _VSCODE_builtins

if _VSCODE_os.path.exists("${__filename}"):
    _VSCODE_builtins.print(f"EXECUTABLE{_VSCODE_sys.executable}EXECUTABLE")

del _VSCODE_os, _VSCODE_sys, _VSCODE_builtins
`;
        const outputs = (await execution.executeHidden(code).catch(noop)) || [];
        const output = outputs.find((item) => item.output_type === 'stream' && item.name === 'stdout');
        if (!output || !(output.text || '').toString().includes('EXECUTABLE')) {
            return;
        }
        let text = (output.text || '').toString();
        text = text.substring(text.indexOf('EXECUTABLE'));
        const items = text.split('EXECUTABLE').filter((x) => x.trim().length);
        const executable = items.length ? items[0].trim() : '';
        if (!executable || !(await fs.pathExists(executable))) {
            return;
        }
        logger.debug(
            `Remote Interpreter for Notebook URI "${getDisplayPath(notebook.uri)}" is ${getDisplayPath(executable)}`
        );

        const env = getCachedEnvironment(executable) || (await getInterpreterInfo({ id: executable }));

        if (env) {
            return env;
        } else {
            logger.error(
                `Failed to get remote interpreter information for ${getDisplayPath(notebook.uri)} && ${getDisplayPath(
                    executable
                )}`
            );
        }
    }
}
