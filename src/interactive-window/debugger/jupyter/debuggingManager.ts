// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import {
    debug,
    DebugAdapterDescriptor,
    DebugAdapterInlineImplementation,
    DebugSession,
    DebugSessionOptions,
    NotebookCell,
    NotebookDocument,
    NotebookEditor
} from 'vscode';
import { IKernelProvider } from '../../../kernels/types';
import { IControllerLoader, IControllerRegistration } from '../../../notebooks/controllers/types';
import { pythonIWKernelDebugAdapter } from '../../../notebooks/debugger/constants';
import { DebuggingManagerBase } from '../../../notebooks/debugger/debuggingManagerBase';
import {
    IDebugLocationTrackerFactory,
    IInteractiveWindowDebugConfig,
    KernelDebugMode
} from '../../../notebooks/debugger/debuggingTypes';
import { assertIsInteractiveWindowDebugConfig, IpykernelCheckResult } from '../../../notebooks/debugger/helper';
import { IExtensionSingleActivationService } from '../../../platform/activation/types';
import {
    IApplicationShell,
    ICommandManager,
    IDebugService,
    IVSCodeNotebook
} from '../../../platform/common/application/types';
import { IPlatformService } from '../../../platform/common/platform/types';
import { IConfigurationService } from '../../../platform/common/types';
import { DataScience } from '../../../platform/common/utils/localize';
import { noop } from '../../../platform/common/utils/misc';
import { IServiceContainer } from '../../../platform/ioc/types';
import { traceError, traceInfo, traceInfoIfCI } from '../../../platform/logging';
import * as path from '../../../platform/vscode-path/path';
import { IFileGeneratedCodes } from '../../editor-integration/types';
import { IInteractiveWindowDebuggingManager } from '../../types';
import { buildSourceMap } from '../helper';
import { DebugCellController } from './debugCellController';
import { IWDebugger } from './debugger';
import { KernelDebugAdapter } from './kernelDebugAdapter';
import { RestartNotSupportedController } from './restartNotSupportedController';

/**
 * The DebuggingManager maintains the mapping between notebook documents and debug sessions.
 */
@injectable()
export class InteractiveWindowDebuggingManager
    extends DebuggingManagerBase
    implements IExtensionSingleActivationService, IInteractiveWindowDebuggingManager
{
    public constructor(
        @inject(IKernelProvider) kernelProvider: IKernelProvider,
        @inject(IControllerRegistration) controllerRegistration: IControllerRegistration,
        @inject(IControllerLoader) controllerLoader: IControllerLoader,
        @inject(ICommandManager) commandManager: ICommandManager,
        @inject(IApplicationShell) appShell: IApplicationShell,
        @inject(IVSCodeNotebook) vscNotebook: IVSCodeNotebook,
        @inject(IPlatformService) private readonly platform: IPlatformService,
        @inject(IDebugLocationTrackerFactory)
        private readonly debugLocationTrackerFactory: IDebugLocationTrackerFactory,
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
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
    }

    public override async activate(): Promise<void> {
        await super.activate();
        // factory for kernel debug adapters
        this.disposables.push(
            debug.registerDebugAdapterDescriptorFactory(pythonIWKernelDebugAdapter, {
                createDebugAdapterDescriptor: async (session) => this.createDebugAdapterDescriptor(session)
            })
        );
    }

    public getDebugMode(_notebook: NotebookDocument): KernelDebugMode | undefined {
        return KernelDebugMode.InteractiveWindow;
    }

    public async start(editor: NotebookEditor, cell: NotebookCell) {
        traceInfoIfCI(`Starting debugging IW`);

        const ipykernelResult = await this.checkIpykernelAndPrompt(cell);
        if (ipykernelResult === IpykernelCheckResult.Ok) {
            await this.startDebuggingCell(editor.notebook, cell);
        }
    }

    private async startDebuggingCell(doc: NotebookDocument, cell: NotebookCell) {
        const settings = this.configService.getSettings(doc.uri);
        const config: IInteractiveWindowDebugConfig = {
            type: pythonIWKernelDebugAdapter,
            name: path.basename(doc.uri.toString()),
            request: 'attach',
            justMyCode: settings.debugJustMyCode,
            __notebookUri: doc.uri.toString(),
            // add a property to the config to know if the session is runByLine
            __mode: KernelDebugMode.InteractiveWindow,
            __cellIndex: cell.index
        };
        const opts: DebugSessionOptions = { suppressSaveBeforeStart: true };
        await this.startDebuggingConfig(config, opts);
        const dbgr = this.notebookToDebugger.get(doc);
        if (!dbgr) {
            traceError('Debugger not found, could not start debugging.');
            return;
        }
        await (dbgr as IWDebugger).ready;
    }

    protected async createDebugAdapterDescriptor(session: DebugSession): Promise<DebugAdapterDescriptor | undefined> {
        const config = session.configuration as IInteractiveWindowDebugConfig;
        assertIsInteractiveWindowDebugConfig(config);

        const notebook = this.vscNotebook.notebookDocuments.find((doc) => doc.uri.toString() === config.__notebookUri);
        if (!notebook || typeof config.__cellIndex !== 'number') {
            traceError('Invalid debug session for debugging of IW using Jupyter Protocol');
            return;
        }

        if (this.notebookInProgress.has(notebook)) {
            traceInfo(`Cannot start debugging. Already debugging this notebook`);
            return;
        }

        if (this.isDebugging(notebook)) {
            traceInfo(`Cannot start debugging. Already debugging this notebook document. Toolbar should update`);
            return;
        }

        const dbgr = new IWDebugger(notebook, config, session);
        this.notebookToDebugger.set(notebook, dbgr);
        try {
            this.notebookInProgress.add(notebook);
            return await this.doCreateDebugAdapterDescriptor(config, session, notebook, dbgr);
        } finally {
            this.notebookInProgress.delete(notebook);
        }
    }

    private async doCreateDebugAdapterDescriptor(
        config: IInteractiveWindowDebugConfig,
        session: DebugSession,
        notebook: NotebookDocument,
        dbgr: IWDebugger
    ): Promise<DebugAdapterDescriptor | undefined> {
        const kernel = await this.ensureKernelIsRunning(notebook);
        if (!kernel?.session) {
            this.appShell.showInformationMessage(DataScience.kernelWasNotStarted()).then(noop, noop);
            return;
        }
        const adapter = new KernelDebugAdapter(
            session,
            notebook,
            kernel.session,
            kernel,
            this.platform,
            this.debugService,
            this.debugLocationTrackerFactory
        );

        this.disposables.push(adapter.onDidEndSession(this.endSession.bind(this)));

        const cell = notebook.cellAt(config.__cellIndex);
        const controller = new DebugCellController(adapter, cell, this.kernelProvider.getKernelExecution(kernel!));
        adapter.addDebuggingDelegates([controller, new RestartNotSupportedController(cell, this.serviceContainer)]);
        controller.ready
            .then(() => dbgr.resolve())
            .catch((ex) => console.error('Failed waiting for controller to be ready', ex));

        this.trackDebugAdapter(notebook, adapter);
        return new DebugAdapterInlineImplementation(adapter);
    }

    // TODO: This will likely be needed for mapping breakpoints and such
    public async updateSourceMaps(notebookEditor: NotebookEditor, hashes: IFileGeneratedCodes[]): Promise<void> {
        // Make sure that we have an active debugging session at this point
        let debugSession = this.getDebugSession(notebookEditor.notebook);
        if (debugSession) {
            traceInfoIfCI(`Sending debug request for source map`);
            await Promise.all(
                hashes.map(async (fileHash) => {
                    if (debugSession) {
                        return debugSession.customRequest('setPydevdSourceMap', buildSourceMap(fileHash));
                    }
                })
            );
        }
    }
}
