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
    NotebookEditor,
    Uri
} from 'vscode';
import { IKernelProvider } from '../../kernels/types';
import { IExtensionSingleActivationService } from '../../platform/activation/types';
import {
    IApplicationShell,
    ICommandManager,
    IDebugService,
    IVSCodeNotebook
} from '../../platform/common/application/types';
import { Commands as DSCommands, EditorContexts } from '../../platform/common/constants';
import { ContextKey } from '../../platform/common/contextKey';
import { IPlatformService } from '../../platform/common/platform/types';
import { IConfigurationService } from '../../platform/common/types';
import { DataScience } from '../../platform/common/utils/localize';
import { noop } from '../../platform/common/utils/misc';
import { traceError, traceInfo, traceInfoIfCI } from '../../platform/logging';
import { ResourceSet } from '../../platform/vscode-path/map';
import * as path from '../../platform/vscode-path/path';
import { sendTelemetryEvent } from '../../telemetry';
import { IControllerLoader, IControllerSelection } from '../controllers/types';
import { DebuggingTelemetry, pythonKernelDebugAdapter } from './constants';
import { DebugCellController } from './debugCellControllers';
import { DebuggingManagerBase } from './debuggingManagerBase';
import { IDebuggingManager, IKernelDebugAdapterConfig, KernelDebugMode } from './debuggingTypes';
import { assertIsDebugConfig, IpykernelCheckResult } from './helper';
import { KernelDebugAdapter } from './kernelDebugAdapter';
import { KernelDebugAdapterBase } from './kernelDebugAdapterBase';
import { RunByLineController } from './runByLineController';

/**
 * The DebuggingManager maintains the mapping between notebook documents and debug sessions.
 */
@injectable()
export class DebuggingManager
    extends DebuggingManagerBase
    implements IExtensionSingleActivationService, IDebuggingManager
{
    private runByLineCells: ContextKey<Uri[]>;
    private runByLineDocuments: ContextKey<Uri[]>;
    private debugDocuments: ContextKey<Uri[]>;
    private notebookToRunByLineController = new Map<NotebookDocument, RunByLineController>();

    public constructor(
        @inject(IKernelProvider) kernelProvider: IKernelProvider,
        @inject(IControllerLoader) controllerLoader: IControllerLoader,
        @inject(IControllerSelection) controllerSelection: IControllerSelection,
        @inject(ICommandManager) commandManager: ICommandManager,
        @inject(IApplicationShell) appShell: IApplicationShell,
        @inject(IVSCodeNotebook) vscNotebook: IVSCodeNotebook,
        @inject(IConfigurationService) private readonly settings: IConfigurationService,
        @inject(IPlatformService) private readonly platform: IPlatformService,
        @inject(IDebugService) private readonly debugService: IDebugService
    ) {
        super(kernelProvider, controllerLoader, controllerSelection, commandManager, appShell, vscNotebook);
        this.runByLineCells = new ContextKey(EditorContexts.RunByLineCells, commandManager);
        this.runByLineDocuments = new ContextKey(EditorContexts.RunByLineDocuments, commandManager);
        this.debugDocuments = new ContextKey(EditorContexts.DebugDocuments, commandManager);
    }

    public override async activate() {
        await super.activate();
        this.disposables.push(
            // factory for kernel debug adapters
            debug.registerDebugAdapterDescriptorFactory(pythonKernelDebugAdapter, {
                createDebugAdapterDescriptor: async (session) => this.createDebugAdapterDescriptor(session)
            }),
            this.commandManager.registerCommand(DSCommands.DebugNotebook, async () => {
                const editor = this.vscNotebook.activeNotebookEditor;
                await this.tryToStartDebugging(KernelDebugMode.Everything, editor);
            }),

            this.commandManager.registerCommand(DSCommands.RunByLine, async (cell: NotebookCell | undefined) => {
                sendTelemetryEvent(DebuggingTelemetry.clickedRunByLine);
                const editor = this.vscNotebook.activeNotebookEditor;
                if (!cell) {
                    const range = editor?.selections[0];
                    if (range) {
                        cell = editor?.notebook.cellAt(range.start);
                    }
                }

                if (!cell) {
                    return;
                }

                await this.tryToStartDebugging(KernelDebugMode.RunByLine, editor, cell);
            }),

            this.commandManager.registerCommand(DSCommands.RunByLineNext, (cell: NotebookCell | undefined) => {
                if (!cell) {
                    const editor = this.vscNotebook.activeNotebookEditor;
                    const range = editor?.selections[0];
                    if (range) {
                        cell = editor?.notebook.cellAt(range.start);
                    }
                }

                if (!cell) {
                    return;
                }

                const controller = this.notebookToRunByLineController.get(cell.notebook);
                if (controller && controller.debugCell.document.uri.toString() === cell.document.uri.toString()) {
                    controller.continue();
                }
            }),

            this.commandManager.registerCommand(DSCommands.RunByLineStop, () => {
                const editor = this.vscNotebook.activeNotebookEditor;
                if (editor) {
                    const controller = this.notebookToRunByLineController.get(editor.notebook);
                    if (controller) {
                        sendTelemetryEvent(DebuggingTelemetry.endedSession, undefined, {
                            reason: 'withKeybinding'
                        });
                        controller.stop();
                    }
                }
            }),

            this.commandManager.registerCommand(DSCommands.RunAndDebugCell, async (cell: NotebookCell | undefined) => {
                sendTelemetryEvent(DebuggingTelemetry.clickedRunAndDebugCell);
                const editor = this.vscNotebook.activeNotebookEditor;
                if (!cell) {
                    const range = editor?.selections[0];
                    if (range) {
                        cell = editor?.notebook.cellAt(range.start);
                    }
                }

                if (!cell) {
                    return;
                }

                await this.tryToStartDebugging(KernelDebugMode.Cell, editor, cell);
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

    private async tryToStartDebugging(mode: KernelDebugMode, editor?: NotebookEditor, cell?: NotebookCell) {
        traceInfoIfCI(`Starting debugging with mode ${mode}`);

        if (!editor) {
            this.appShell.showErrorMessage(DataScience.noNotebookToDebug()).then(noop, noop);
            return;
        }

        if (this.notebookInProgress.has(editor.notebook)) {
            traceInfo(`Cannot start debugging. Already debugging this notebook`);
            return;
        }

        if (this.isDebugging(editor.notebook)) {
            traceInfo(`Cannot start debugging. Already debugging this notebook document.`);
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
                    switch (mode) {
                        case KernelDebugMode.Everything: {
                            await this.startDebugging(editor.notebook);
                            return;
                        }
                        case KernelDebugMode.Cell:
                            if (cell) {
                                await this.startDebuggingCell(editor.notebook, KernelDebugMode.Cell, cell);
                            }
                            return;
                        case KernelDebugMode.RunByLine:
                            if (cell) {
                                await this.startDebuggingCell(editor.notebook, KernelDebugMode.RunByLine, cell);
                            }
                            return;
                        default:
                            return;
                    }
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
            this.updateDebugContextKey();
            await checkIpykernelAndStart();
        } catch (e) {
            traceInfo(`Error starting debugging: ${e}`);
        } finally {
            this.notebookInProgress.delete(editor.notebook);
            this.updateDebugContextKey();
        }
    }
    private async startDebuggingCell(
        doc: NotebookDocument,
        mode: KernelDebugMode.Cell | KernelDebugMode.RunByLine,
        cell: NotebookCell
    ) {
        const config: IKernelDebugAdapterConfig = {
            type: pythonKernelDebugAdapter,
            name: path.basename(doc.uri.toString()),
            request: 'attach',
            justMyCode: true,
            // add a property to the config to know if the session is runByLine
            __mode: mode,
            __cellIndex: cell.index
        };
        const opts: DebugSessionOptions | undefined =
            mode === KernelDebugMode.RunByLine
                ? { debugUI: { simple: true }, suppressSaveBeforeStart: true }
                : { suppressSaveBeforeStart: true };
        return this.startDebuggingConfig(doc, config, opts);
    }

    private async startDebugging(doc: NotebookDocument) {
        const config: IKernelDebugAdapterConfig = {
            type: pythonKernelDebugAdapter,
            name: path.basename(doc.uri.toString()),
            request: 'attach',
            internalConsoleOptions: 'neverOpen',
            justMyCode: false,
            __mode: KernelDebugMode.Everything
        };
        return this.startDebuggingConfig(doc, config);
    }

    protected override trackDebugAdapter(notebook: NotebookDocument, adapter: KernelDebugAdapterBase): void {
        super.trackDebugAdapter(notebook, adapter);
        this.updateDebugContextKey();
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
        if (activeDoc) {
            // TODO we apparently always have a kernel here, clean up typings
            const kernel = await this.ensureKernelIsRunning(activeDoc);
            const debug = this.getDebuggerByUri(activeDoc);

            if (debug) {
                if (kernel?.session) {
                    const adapter = new KernelDebugAdapter(
                        session,
                        debug.document,
                        kernel.session,
                        kernel,
                        this.platform,
                        this.debugService
                    );

                    if (config.__mode === KernelDebugMode.RunByLine && typeof config.__cellIndex === 'number') {
                        const cell = activeDoc.cellAt(config.__cellIndex);
                        const controller = new RunByLineController(
                            adapter,
                            cell,
                            this.commandManager,
                            kernel!,
                            this.settings
                        );
                        adapter.setDebuggingDelegate(controller);
                        this.notebookToRunByLineController.set(debug.document, controller);
                        this.updateRunByLineContextKeys();
                    } else if (config.__mode === KernelDebugMode.Cell && typeof config.__cellIndex === 'number') {
                        const cell = activeDoc.cellAt(config.__cellIndex);
                        const controller = new DebugCellController(adapter, cell, kernel!, this.commandManager);
                        adapter.setDebuggingDelegate(controller);
                    }

                    this.trackDebugAdapter(debug.document, adapter);

                    // Wait till we're attached before resolving the session
                    debug.resolve(session);
                    return new DebugAdapterInlineImplementation(adapter);
                } else {
                    this.appShell.showInformationMessage(DataScience.kernelWasNotStarted()).then(noop, noop);
                }
            }
        }
        traceError('Debug sessions should start only from the cell toolbar command');
        return;
    }
}
