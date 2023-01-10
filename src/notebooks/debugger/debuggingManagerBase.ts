// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import {
    debug,
    DebugSession,
    DebugSessionOptions,
    Event,
    EventEmitter,
    NotebookCell,
    NotebookDocument,
    NotebookEditor,
    workspace,
    window
} from 'vscode';
import { IKernel, IKernelProvider } from '../../kernels/types';
import { IApplicationShell, ICommandManager, IVSCodeNotebook } from '../../platform/common/application/types';
import { IDisposable, IFeaturesManager } from '../../platform/common/types';
import { DataScience } from '../../platform/common/utils/localize';
import { noop } from '../../platform/common/utils/misc';
import { traceError, traceInfo, traceInfoIfCI } from '../../platform/logging';
import { sendTelemetryEvent } from '../../telemetry';
import { IControllerRegistration } from '../controllers/types';
import { DebuggingTelemetry } from './constants';
import { Debugger } from './debugger';
import { IDebuggingManager, INotebookDebugConfig, KernelDebugMode } from './debuggingTypes';
import { IpykernelCheckResult, isUsingIpykernel6OrLater } from './helper';
import { KernelDebugAdapterBase } from './kernelDebugAdapterBase';
import { KernelConnector } from '../controllers/kernelConnector';
import { IServiceContainer } from '../../platform/ioc/types';
import { DisplayOptions } from '../../kernels/displayOptions';

/**
 * The DebuggingManager maintains the mapping between notebook documents and debug sessions.
 */
export abstract class DebuggingManagerBase implements IDisposable, IDebuggingManager {
    protected notebookToDebugger = new Map<NotebookDocument, Debugger>();
    protected notebookToDebugAdapter = new Map<NotebookDocument, KernelDebugAdapterBase>();
    protected notebookInProgress = new Set<NotebookDocument>();
    protected readonly disposables: IDisposable[] = [];
    private _doneDebugging = new EventEmitter<void>();

    public constructor(
        protected readonly kernelProvider: IKernelProvider,
        private readonly controllerRegistration: IControllerRegistration,
        protected readonly commandManager: ICommandManager,
        protected readonly appShell: IApplicationShell,
        protected readonly vscNotebook: IVSCodeNotebook,
        protected readonly serviceContainer: IServiceContainer
    ) {}

    public activate() {
        this.disposables.push(
            // track termination of debug sessions
            debug.onDidTerminateDebugSession(this.endSession.bind(this)),

            // track closing of notebooks documents
            workspace.onDidCloseNotebookDocument(async (document) => {
                const dbg = this.notebookToDebugger.get(document);
                if (dbg) {
                    await debug.stopDebugging(dbg.session);
                    this.onDidStopDebugging(document);
                }
            })
        );
    }

    abstract getDebugMode(notebook: NotebookDocument): KernelDebugMode | undefined;

    public getDebugCell(notebook: NotebookDocument): NotebookCell | undefined {
        return this.notebookToDebugAdapter.get(notebook)?.debugCell;
    }

    public get onDoneDebugging(): Event<void> {
        return this._doneDebugging.event;
    }

    public dispose() {
        this.disposables.forEach((d) => d.dispose());
    }

    public isDebugging(notebook: NotebookDocument): boolean {
        return this.notebookToDebugger.has(notebook);
    }

    public getDebugSession(notebook: NotebookDocument): DebugSession | undefined {
        const dbg = this.notebookToDebugger.get(notebook);
        if (dbg) {
            return dbg.session;
        }
    }

    public getDebugAdapter(notebook: NotebookDocument): KernelDebugAdapterBase | undefined {
        return this.notebookToDebugAdapter.get(notebook);
    }

    protected onDidStopDebugging(_notebook: NotebookDocument): void {
        //
    }

    protected async startDebuggingConfig(config: INotebookDebugConfig, options?: DebugSessionOptions) {
        traceInfoIfCI(`Attempting to start debugging with config ${JSON.stringify(config)}`);

        try {
            await debug.startDebugging(undefined, config, options);
        } catch (err) {
            traceError(`Can't start debugging (${err})`);
            this.appShell.showErrorMessage(DataScience.cantStartDebugging()).then(noop, noop);
        }
    }

    protected trackDebugAdapter(notebook: NotebookDocument, adapter: KernelDebugAdapterBase) {
        this.notebookToDebugAdapter.set(notebook, adapter);
        this.disposables.push(adapter.onDidEndSession(this.endSession.bind(this)));
    }

    protected async endSession(session: DebugSession) {
        traceInfo(`Ending debug session ${session.id}`);
        this._doneDebugging.fire();
        for (const [doc, dbg] of this.notebookToDebugger.entries()) {
            if (dbg && session.id === dbg.session.id) {
                this.notebookToDebugger.delete(doc);
                this.notebookToDebugAdapter.delete(doc);
                this.onDidStopDebugging(doc);
                break;
            }
        }
    }

    protected getDebuggerByUri(document: NotebookDocument): Debugger | undefined {
        for (const [doc, dbg] of this.notebookToDebugger.entries()) {
            if (document === doc) {
                return dbg;
            }
        }
    }

    protected async ensureKernelIsRunning(doc: NotebookDocument): Promise<IKernel | undefined> {
        if (this.serviceContainer.get<IFeaturesManager>(IFeaturesManager).features.kernelPickerType === 'Stable') {
            await this.controllerRegistration.loaded;
        }
        const controller = this.controllerRegistration.getSelected(doc);
        let kernel = this.kernelProvider.get(doc);
        if (controller && (!kernel || (kernel && kernel.status === 'unknown'))) {
            kernel = await KernelConnector.connectToNotebookKernel(
                controller.connection,
                this.serviceContainer,
                {
                    notebook: doc,
                    controller: controller.controller,
                    resource: doc.uri
                },
                new DisplayOptions(false),
                this.disposables,
                'jupyterExtension'
            );
        }
        return kernel;
    }

    private findEditorForCell(cell: NotebookCell): NotebookEditor | undefined {
        const notebookUri = cell.notebook.uri.toString();
        return window.visibleNotebookEditors.find((e) => e.notebook.uri.toString() === notebookUri);
    }

    protected async checkIpykernelAndPrompt(
        cell: NotebookCell,
        allowSelectKernel: boolean = true
    ): Promise<IpykernelCheckResult> {
        const editor = this.findEditorForCell(cell);
        if (!editor) {
            this.appShell.showErrorMessage(DataScience.noNotebookToDebug()).then(noop, noop);
            return IpykernelCheckResult.Unknown;
        }

        const ipykernelResult = await this.checkForIpykernel6(editor.notebook);
        switch (ipykernelResult) {
            case IpykernelCheckResult.NotInstalled:
                // User would have been notified about this, nothing more to do.
                break;
            case IpykernelCheckResult.Outdated:
            case IpykernelCheckResult.Unknown: {
                this.promptInstallIpykernel6().then(noop, noop);
                break;
            }
            case IpykernelCheckResult.ControllerNotSelected: {
                if (allowSelectKernel) {
                    await this.commandManager.executeCommand('notebook.selectKernel', { notebookEditor: editor });
                    return await this.checkIpykernelAndPrompt(cell, false);
                }
            }
        }

        return ipykernelResult;
    }

    private async checkForIpykernel6(doc: NotebookDocument): Promise<IpykernelCheckResult> {
        try {
            let kernel = this.kernelProvider.get(doc);
            if (!kernel) {
                const controller = this.controllerRegistration.getSelected(doc);
                if (!controller) {
                    return IpykernelCheckResult.ControllerNotSelected;
                }
                kernel = this.kernelProvider.getOrCreate(doc, {
                    metadata: controller.connection,
                    controller: controller?.controller,
                    resourceUri: doc.uri
                });
            }
            const execution = this.kernelProvider.getKernelExecution(kernel);
            const result = await isUsingIpykernel6OrLater(execution);
            sendTelemetryEvent(DebuggingTelemetry.ipykernel6Status, undefined, {
                status: result === IpykernelCheckResult.Ok ? 'installed' : 'notInstalled'
            });
            return result;
        } catch (ex) {
            traceError('Debugging: Could not check for ipykernel 6', ex);
        }
        return IpykernelCheckResult.Unknown;
    }

    private async promptInstallIpykernel6() {
        const response = await this.appShell.showInformationMessage(
            DataScience.needIpykernel6(),
            { modal: true },
            DataScience.setup()
        );

        if (response === DataScience.setup()) {
            sendTelemetryEvent(DebuggingTelemetry.clickedOnSetup);
            this.appShell.openUrl(
                'https://github.com/microsoft/vscode-jupyter/wiki/Setting-Up-Run-by-Line-and-Debugging-for-Notebooks'
            );
        } else {
            sendTelemetryEvent(DebuggingTelemetry.closedModal);
        }
    }
}
