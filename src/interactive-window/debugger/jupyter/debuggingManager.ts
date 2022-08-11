// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import {
    NotebookDocument,
    DebugAdapterInlineImplementation,
    DebugSession,
    NotebookCell,
    DebugSessionOptions,
    DebugAdapterDescriptor,
    NotebookEditor,
    debug
} from 'vscode';
import { pythonIWKernelDebugAdapter } from '../../../notebooks/debugger/constants';
import {
    IDebuggingManager,
    KernelDebugMode,
    IKernelDebugAdapterConfig,
    IDebugLocationTrackerFactory
} from '../../../notebooks/debugger/debuggingTypes';
import { IKernelProvider } from '../../../kernels/types';
import { IpykernelCheckResult, assertIsDebugConfig } from '../../../notebooks/debugger/helper';
import { KernelDebugAdapter } from './kernelDebugAdapter';
import { IExtensionSingleActivationService } from '../../../platform/activation/types';
import {
    ICommandManager,
    IApplicationShell,
    IVSCodeNotebook,
    IDebugService
} from '../../../platform/common/application/types';
import { IPlatformService } from '../../../platform/common/platform/types';
import { DataScience } from '../../../platform/common/utils/localize';
import { traceInfoIfCI, traceInfo, traceError } from '../../../platform/logging';
import * as path from '../../../platform/vscode-path/path';
import { DebugCellController } from './debugCellControllers';
import { DebuggingManagerBase } from '../../../notebooks/debugger/debuggingManagerBase';
import { IConfigurationService } from '../../../platform/common/types';
import { IFileGeneratedCodes } from '../../editor-integration/types';
import { buildSourceMap } from '../helper';
import { noop } from '../../../platform/common/utils/misc';
import { IInteractiveWindowDebuggingManager } from '../../types';
import { IControllerLoader, IControllerSelection } from '../../../notebooks/controllers/types';

/**
 * The DebuggingManager maintains the mapping between notebook documents and debug sessions.
 */
@injectable()
export class InteractiveWindowDebuggingManager
    extends DebuggingManagerBase
    implements IExtensionSingleActivationService, IDebuggingManager, IInteractiveWindowDebuggingManager
{
    public constructor(
        @inject(IKernelProvider) kernelProvider: IKernelProvider,
        @inject(IControllerSelection) controllerSelection: IControllerSelection,
        @inject(IControllerLoader) controllerLoader: IControllerLoader,
        @inject(ICommandManager) commandManager: ICommandManager,
        @inject(IApplicationShell) appShell: IApplicationShell,
        @inject(IVSCodeNotebook) vscNotebook: IVSCodeNotebook,
        @inject(IPlatformService) private readonly platform: IPlatformService,
        @inject(IDebugLocationTrackerFactory)
        private readonly debugLocationTrackerFactory: IDebugLocationTrackerFactory,
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(IDebugService) private readonly debugService: IDebugService
    ) {
        super(kernelProvider, controllerLoader, controllerSelection, commandManager, appShell, vscNotebook);
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

        if (this.notebookInProgress.has(editor.notebook)) {
            traceInfo(`Cannot start debugging. Already debugging this notebook`);
            return;
        }

        if (this.isDebugging(editor.notebook)) {
            traceInfo(`Cannot start debugging. Already debugging this notebook document. Toolbar should update`);
            return;
        }

        const checkIpykernelAndStart = async (allowSelectKernel = true): Promise<void> => {
            const ipykernelResult = await this.checkForIpykernel6(editor.notebook);
            switch (ipykernelResult) {
                case IpykernelCheckResult.NotInstalled:
                    // User would have been notified about this, nothing more to do.
                    return;
                case IpykernelCheckResult.Outdated:
                case IpykernelCheckResult.Unknown: {
                    this.promptInstallIpykernel6().then(noop, noop);
                    return;
                }
                case IpykernelCheckResult.Ok: {
                    await this.startDebuggingCell(editor.notebook, cell);
                    return;
                }
                case IpykernelCheckResult.ControllerNotSelected: {
                    if (allowSelectKernel) {
                        await this.commandManager.executeCommand('notebook.selectKernel', { notebookEditor: editor });
                        await checkIpykernelAndStart(false);
                    }
                }
            }
        };

        try {
            this.notebookInProgress.add(editor.notebook);
            await checkIpykernelAndStart();
        } catch (e) {
            traceInfo(`Error starting debugging: ${e}`);
        } finally {
            this.notebookInProgress.delete(editor.notebook);
        }
    }

    private async startDebuggingCell(doc: NotebookDocument, cell: NotebookCell) {
        const settings = this.configService.getSettings(doc.uri);
        const config: IKernelDebugAdapterConfig = {
            type: pythonIWKernelDebugAdapter,
            name: path.basename(doc.uri.toString()),
            request: 'attach',
            justMyCode: settings.debugJustMyCode,
            __interactiveWindowNotebookUri: doc.uri.toString(),
            // add a property to the config to know if the session is runByLine
            __mode: KernelDebugMode.InteractiveWindow,
            __cellIndex: cell.index
        };
        const opts: DebugSessionOptions = { suppressSaveBeforeStart: true };
        return this.startDebuggingConfig(doc, config, opts);
    }

    protected override async createDebugAdapterDescriptor(
        session: DebugSession
    ): Promise<DebugAdapterDescriptor | undefined> {
        const config = session.configuration;
        assertIsDebugConfig(config);

        const activeDoc = config.__interactiveWindowNotebookUri
            ? this.vscNotebook.notebookDocuments.find(
                  (doc) => doc.uri.toString() === config.__interactiveWindowNotebookUri
              )
            : this.vscNotebook.activeNotebookEditor?.notebook;
        if (!activeDoc || typeof config.__cellIndex !== 'number') {
            // This cannot happen.
            traceError('Invalid debug session for debugging of IW using Jupyter Protocol');
            return;
        }

        // TODO we apparently always have a kernel here, clean up typings
        const kernel = await this.ensureKernelIsRunning(activeDoc);
        const debug = this.getDebuggerByUri(activeDoc);
        if (!debug) {
            return;
        }
        if (!kernel?.session) {
            this.appShell.showInformationMessage(DataScience.kernelWasNotStarted()).then(noop, noop);
            return;
        }
        const adapter = new KernelDebugAdapter(
            session,
            debug.document,
            kernel.session,
            kernel,
            this.platform,
            this.debugService,
            this.debugLocationTrackerFactory
        );

        this.disposables.push(adapter.onDidEndSession(this.endSession.bind(this)));

        // Wait till we're attached before resolving the session
        const cell = activeDoc.cellAt(config.__cellIndex);
        const controller = new DebugCellController(adapter, cell, kernel!);
        adapter.setDebuggingDelegate(controller);
        controller.ready
            .then(() => debug.resolve(session))
            .catch((ex) => console.error('Failed waiting for controller to be ready', ex));

        this.trackDebugAdapter(activeDoc, adapter);
        return new DebugAdapterInlineImplementation(adapter);
    }

    // TODO: This will likely be needed for mapping breakpoints and such
    public async updateSourceMaps(notebookEditor: NotebookEditor, hashes: IFileGeneratedCodes[]): Promise<void> {
        // Make sure that we have an active debugging session at this point
        let debugSession = await this.getDebugSession(notebookEditor.notebook);
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
