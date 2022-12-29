// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import {
    debug,
    DebugAdapterDescriptor,
    DebugAdapterInlineImplementation,
    DebugSession,
    DebugSessionOptions,
    NotebookCell,
    NotebookDocument,
    Uri
} from 'vscode';
import { IKernelProvider } from '../../kernels/types';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import {
    IApplicationShell,
    ICommandManager,
    IDebugService,
    IVSCodeNotebook
} from '../../platform/common/application/types';
import { EditorContexts } from '../../platform/common/constants';
import { ContextKey } from '../../platform/common/contextKey';
import { IPlatformService } from '../../platform/common/platform/types';
import { IConfigurationService } from '../../platform/common/types';
import { DataScience } from '../../platform/common/utils/localize';
import { noop } from '../../platform/common/utils/misc';
import { IServiceContainer } from '../../platform/ioc/types';
import { traceInfo } from '../../platform/logging';
import { ResourceSet } from '../../platform/vscode-path/map';
import * as path from '../../platform/vscode-path/path';
import { sendTelemetryEvent } from '../../telemetry';
import { IControllerLoader, IControllerRegistration } from '../controllers/types';
import { DebuggingTelemetry, pythonKernelDebugAdapter } from './constants';
import { DebugCellController } from './controllers/debugCellController';
import { RestartController } from './controllers/restartController';
import { RunByLineController } from './controllers/runByLineController';
import { Debugger } from './debugger';
import { DebuggingManagerBase } from './debuggingManagerBase';
import { INotebookDebugConfig, INotebookDebuggingManager, KernelDebugMode } from './debuggingTypes';
import { assertIsDebugConfig, IpykernelCheckResult } from './helper';
import { KernelDebugAdapter } from './kernelDebugAdapter';

/**
 * The DebuggingManager maintains the mapping between notebook documents and debug sessions.
 */
@injectable()
export class DebuggingManager
    extends DebuggingManagerBase
    implements IExtensionSyncActivationService, INotebookDebuggingManager
{
    private runByLineCells: ContextKey<Uri[]>;
    private runByLineDocuments: ContextKey<Uri[]>;
    private debugDocuments: ContextKey<Uri[]>;
    private notebookToRunByLineController = new Map<NotebookDocument, RunByLineController>();

    public constructor(
        @inject(IKernelProvider) kernelProvider: IKernelProvider,
        @inject(IControllerLoader) controllerLoader: IControllerLoader,
        @inject(IControllerRegistration) controllerRegistration: IControllerRegistration,
        @inject(ICommandManager) commandManager: ICommandManager,
        @inject(IApplicationShell) appShell: IApplicationShell,
        @inject(IVSCodeNotebook) vscNotebook: IVSCodeNotebook,
        @inject(IConfigurationService) private readonly configurationService: IConfigurationService,
        @inject(IPlatformService) private readonly platform: IPlatformService,
        @inject(IDebugService) private readonly debugService: IDebugService,
        @inject(IServiceContainer) serviceContainer: IServiceContainer
    ) {
        super(
            kernelProvider,
            controllerLoader,
            controllerRegistration,
            commandManager,
            appShell,
            vscNotebook,
            serviceContainer
        );
        this.runByLineCells = new ContextKey(EditorContexts.RunByLineCells, commandManager);
        this.runByLineDocuments = new ContextKey(EditorContexts.RunByLineDocuments, commandManager);
        this.debugDocuments = new ContextKey(EditorContexts.DebugDocuments, commandManager);
    }

    public override activate() {
        super.activate();
        this.disposables.push(
            // factory for kernel debug adapters
            debug.registerDebugAdapterDescriptorFactory(pythonKernelDebugAdapter, {
                createDebugAdapterDescriptor: async (session) => this.createDebugAdapterDescriptor(session)
            })
        );
    }

    public getDebugMode(notebook: NotebookDocument): KernelDebugMode | undefined {
        const controller = this.notebookToRunByLineController.get(notebook);
        return controller?.getMode();
    }

    protected override onDidStopDebugging(notebook: NotebookDocument) {
        super.onDidStopDebugging(notebook);
        this.notebookToRunByLineController.delete(notebook);
        this.updateRunByLineContextKeys();
        this.updateDebugContextKey();
    }

    private updateRunByLineContextKeys() {
        const rblCellUris: Uri[] = [];
        const rblDocumentUris: Uri[] = [];
        this.notebookToRunByLineController.forEach((controller) => {
            rblCellUris.push(controller.debugCell.document.uri);
            rblDocumentUris.push(controller.debugCell.notebook.uri);
        });

        this.runByLineCells.set(rblCellUris).ignoreErrors();
        this.runByLineDocuments.set(rblDocumentUris).ignoreErrors();
    }

    private updateDebugContextKey() {
        const debugDocumentUris = new ResourceSet();
        this.notebookToDebugAdapter.forEach((_, notebook) => debugDocumentUris.add(notebook.uri));
        this.notebookInProgress.forEach((notebook) => debugDocumentUris.add(notebook.uri));
        this.debugDocuments.set(Array.from(debugDocumentUris.values())).ignoreErrors();
    }

    public async tryToStartDebugging(mode: KernelDebugMode, cell: NotebookCell, skipIpykernelCheck = false) {
        traceInfo(`Starting debugging with mode ${mode}`);

        if (!skipIpykernelCheck) {
            const ipykernelResult = await this.checkIpykernelAndPrompt(cell);
            if (ipykernelResult !== IpykernelCheckResult.Ok) {
                traceInfo(`Ipykernel check failed: ${IpykernelCheckResult[ipykernelResult]}`);
                return;
            }
        }

        if (mode === KernelDebugMode.RunByLine || mode === KernelDebugMode.Cell) {
            await this.startDebuggingCell(mode, cell!);
        }
    }

    public runByLineNext(cell: NotebookCell) {
        const controller = this.notebookToRunByLineController.get(cell.notebook);
        if (controller && controller.debugCell.document.uri.toString() === cell.document.uri.toString()) {
            controller.continue();
        }
    }

    public runByLineStop(cell: NotebookCell) {
        const controller = this.notebookToRunByLineController.get(cell.notebook);
        if (controller) {
            sendTelemetryEvent(DebuggingTelemetry.endedSession, undefined, {
                reason: 'withKeybinding'
            });
            controller.stop();
        }
    }

    private async startDebuggingCell(mode: KernelDebugMode.Cell | KernelDebugMode.RunByLine, cell: NotebookCell) {
        const doc = cell.notebook;
        const settings = this.configurationService.getSettings(doc.uri);
        const config: INotebookDebugConfig = {
            type: pythonKernelDebugAdapter,
            name: path.basename(doc.uri.toString()),
            request: 'attach',
            justMyCode: mode === KernelDebugMode.Cell ? settings.debugJustMyCode : true,
            // add a property to the config to know if the session is runByLine
            __mode: mode,
            __cellIndex: cell.index,
            __notebookUri: doc.uri.toString()
        };
        const opts: DebugSessionOptions | undefined =
            mode === KernelDebugMode.RunByLine
                ? {
                      suppressDebugStatusbar: true,
                      suppressDebugToolbar: true,
                      suppressDebugView: true,
                      suppressSaveBeforeStart: true
                  }
                : { suppressSaveBeforeStart: true };
        return this.startDebuggingConfig(config, opts);
    }

    protected async createDebugAdapterDescriptor(session: DebugSession): Promise<DebugAdapterDescriptor | undefined> {
        const config = session.configuration;
        assertIsDebugConfig(config);

        const notebookUri = config.__notebookUri;
        const notebook = this.vscNotebook.notebookDocuments.find((doc) => doc.uri.toString() === notebookUri);

        if (!notebook) {
            traceInfo(`Cannot start debugging. Notebook ${notebookUri} not found.`);
            return;
        }

        if (this.notebookInProgress.has(notebook)) {
            traceInfo(`Cannot start debugging. Already debugging this notebook`);
            return;
        }

        if (this.isDebugging(notebook)) {
            traceInfo(`Cannot start debugging. Already debugging this notebook document.`);
            return;
        }

        this.notebookToDebugger.set(notebook, new Debugger(notebook, config, session));
        try {
            this.notebookInProgress.add(notebook);
            this.updateDebugContextKey();
            return await this.doCreateDebugAdapterDescriptor(config, session, notebook);
        } finally {
            this.notebookInProgress.delete(notebook);
            this.updateDebugContextKey();
        }
    }

    private async doCreateDebugAdapterDescriptor(
        config: INotebookDebugConfig,
        session: DebugSession,
        notebook: NotebookDocument
    ): Promise<DebugAdapterDescriptor | undefined> {
        const kernel = await this.ensureKernelIsRunning(notebook);
        if (kernel?.session) {
            const adapter = new KernelDebugAdapter(
                session,
                notebook,
                kernel.session,
                kernel,
                this.platform,
                this.debugService
            );

            if (config.__mode === KernelDebugMode.RunByLine && typeof config.__cellIndex === 'number') {
                const cell = notebook.cellAt(config.__cellIndex);
                const rblController = new RunByLineController(
                    adapter,
                    cell,
                    this.commandManager,
                    this.kernelProvider.getKernelExecution(kernel!),
                    this.configurationService
                );
                adapter.addDebuggingDelegates([
                    rblController,
                    new RestartController(KernelDebugMode.RunByLine, adapter, cell, this.serviceContainer)
                ]);
                this.notebookToRunByLineController.set(notebook, rblController);
                this.updateRunByLineContextKeys();
            } else if (config.__mode === KernelDebugMode.Cell && typeof config.__cellIndex === 'number') {
                const cell = notebook.cellAt(config.__cellIndex);
                const controller = new DebugCellController(
                    adapter,
                    cell,
                    this.kernelProvider.getKernelExecution(kernel!),
                    this.commandManager
                );
                adapter.addDebuggingDelegates([
                    controller,
                    new RestartController(KernelDebugMode.Cell, adapter, cell, this.serviceContainer)
                ]);
            }

            this.trackDebugAdapter(notebook, adapter);
            this.updateDebugContextKey();

            return new DebugAdapterInlineImplementation(adapter);
        } else {
            this.appShell.showInformationMessage(DataScience.kernelWasNotStarted()).then(noop, noop);
        }

        return;
    }
}
