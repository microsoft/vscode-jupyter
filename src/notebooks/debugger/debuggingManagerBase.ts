// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import {
    debug,
    NotebookDocument,
    workspace,
    DebugSession,
    DebugSessionOptions,
    DebugAdapterDescriptor,
    Event,
    EventEmitter,
    NotebookCell
} from 'vscode';
import { IKernel, IKernelProvider } from '../../kernels/types';
import { IDisposable } from '../../platform/common/types';
import { IApplicationShell, ICommandManager, IVSCodeNotebook } from '../../platform/common/application/types';
import { DebuggingTelemetry } from './constants';
import { sendTelemetryEvent } from '../../telemetry';
import { traceError, traceInfoIfCI } from '../../platform/logging';
import { DataScience } from '../../platform/common/utils/localize';
import { IKernelDebugAdapterConfig } from './debuggingTypes';
import { Debugger } from './debugger';
import { KernelDebugAdapterBase } from './kernelDebugAdapterBase';
import { IpykernelCheckResult, isUsingIpykernel6OrLater } from './helper';
import { noop } from '../../platform/common/utils/misc';
import { IControllerLoader, IControllerSelection } from '../controllers/types';

/**
 * The DebuggingManager maintains the mapping between notebook documents and debug sessions.
 */
export abstract class DebuggingManagerBase implements IDisposable {
    private notebookToDebugger = new Map<NotebookDocument, Debugger>();
    protected notebookToDebugAdapter = new Map<NotebookDocument, KernelDebugAdapterBase>();
    protected notebookInProgress = new Set<NotebookDocument>();
    protected readonly disposables: IDisposable[] = [];
    private _doneDebugging = new EventEmitter<void>();

    public constructor(
        private kernelProvider: IKernelProvider,
        private readonly notebookControllerLoader: IControllerLoader,
        private readonly notebookControllerSelection: IControllerSelection,
        protected readonly commandManager: ICommandManager,
        protected readonly appShell: IApplicationShell,
        protected readonly vscNotebook: IVSCodeNotebook
    ) {}

    public async activate() {
        this.disposables.push(
            // track termination of debug sessions
            debug.onDidTerminateDebugSession(this.endSession.bind(this)),

            // track closing of notebooks documents
            workspace.onDidCloseNotebookDocument(async (document) => {
                const dbg = this.notebookToDebugger.get(document);
                if (dbg) {
                    await dbg.stop();
                    this.onDidStopDebugging(document);
                }
            })
        );
    }
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

    public getDebugSession(notebook: NotebookDocument): Promise<DebugSession> | undefined {
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

    protected async startDebuggingConfig(
        doc: NotebookDocument,
        config: IKernelDebugAdapterConfig,
        options?: DebugSessionOptions
    ) {
        traceInfoIfCI(`Attempting to start debugging with config ${JSON.stringify(config)}`);
        let dbg = this.notebookToDebugger.get(doc);
        if (!dbg) {
            dbg = new Debugger(doc, config, options);
            this.notebookToDebugger.set(doc, dbg);

            try {
                const session = await dbg.session;
                traceInfoIfCI(`Debugger session is ready. Should be debugging ${session.id} now`);
            } catch (err) {
                traceError(`Can't start debugging (${err})`);
                this.appShell.showErrorMessage(DataScience.cantStartDebugging()).then(noop, noop);
            }
        } else {
            traceInfoIfCI(`Not starting debugging because already debugging in this notebook`);
        }
    }

    protected trackDebugAdapter(notebook: NotebookDocument, adapter: KernelDebugAdapterBase) {
        this.notebookToDebugAdapter.set(notebook, adapter);
        this.disposables.push(adapter.onDidEndSession(this.endSession.bind(this)));
    }
    protected async endSession(session: DebugSession) {
        traceInfoIfCI(`Ending debug session ${session.id}`);
        this._doneDebugging.fire();
        for (const [doc, dbg] of this.notebookToDebugger.entries()) {
            if (dbg && session.id === (await dbg.session).id) {
                this.notebookToDebugger.delete(doc);
                this.notebookToDebugAdapter.delete(doc);
                this.onDidStopDebugging(doc);
                break;
            }
        }
    }

    protected abstract createDebugAdapterDescriptor(session: DebugSession): Promise<DebugAdapterDescriptor | undefined>;

    protected getDebuggerByUri(document: NotebookDocument): Debugger | undefined {
        for (const [doc, dbg] of this.notebookToDebugger.entries()) {
            if (document === doc) {
                return dbg;
            }
        }
    }

    protected async ensureKernelIsRunning(doc: NotebookDocument): Promise<IKernel | undefined> {
        await this.notebookControllerLoader.loaded;
        const controller = this.notebookControllerSelection.getSelected(doc);

        let kernel = this.kernelProvider.get(doc);
        if (!kernel && controller) {
            kernel = this.kernelProvider.getOrCreate(doc, {
                metadata: controller.connection,
                controller: controller?.controller,
                resourceUri: doc.uri
            });
        }
        if (kernel && kernel.status === 'unknown') {
            await kernel.start();
        }

        return kernel;
    }

    protected async checkForIpykernel6(doc: NotebookDocument): Promise<IpykernelCheckResult> {
        try {
            let kernel = this.kernelProvider.get(doc);
            if (!kernel) {
                const controller = this.notebookControllerSelection.getSelected(doc);
                if (!controller) {
                    return IpykernelCheckResult.ControllerNotSelected;
                }
                kernel = this.kernelProvider.getOrCreate(doc, {
                    metadata: controller.connection,
                    controller: controller?.controller,
                    resourceUri: doc.uri
                });
            }

            const result = await isUsingIpykernel6OrLater(kernel);
            sendTelemetryEvent(DebuggingTelemetry.ipykernel6Status, undefined, {
                status: result === IpykernelCheckResult.Ok ? 'installed' : 'notInstalled'
            });
            return result;
        } catch (ex) {
            traceError('Debugging: Could not check for ipykernel 6', ex);
        }
        return IpykernelCheckResult.Unknown;
    }

    protected async promptInstallIpykernel6() {
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
