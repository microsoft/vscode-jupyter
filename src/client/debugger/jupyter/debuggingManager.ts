// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import {
    debug,
    NotebookDocument,
    workspace,
    DebugAdapterInlineImplementation,
    DebugSession,
    NotebookCell,
    DebugSessionOptions,
    DebugAdapterDescriptor,
    Event,
    EventEmitter,
    NotebookEditor
} from 'vscode';
import * as path from 'path';
import { IKernel, IKernelProvider } from '../../datascience/jupyter/kernels/types';
import { IConfigurationService, IDisposable } from '../../common/types';
import { KernelDebugAdapter } from './kernelDebugAdapter';
import { IExtensionSingleActivationService } from '../../activation/types';
import { INotebookControllerManager } from '../../datascience/notebook/types';
import { ContextKey } from '../../common/contextKey';
import { EditorContexts } from '../../datascience/constants';
import { IApplicationShell, ICommandManager, IVSCodeNotebook } from '../../common/application/types';
import { traceError } from '../../common/logger';
import { DataScience } from '../../common/utils/localize';
import { Commands as DSCommands } from '../../datascience/constants';
import { IFileSystem } from '../../common/platform/types';
import { IDebuggingManager, IKernelDebugAdapterConfig, KernelDebugMode } from '../types';
import { DebuggingTelemetry, pythonKernelDebugAdapter } from '../constants';
import { sendTelemetryEvent } from '../../telemetry';
import { DebugCellController, RunByLineController } from './debugControllers';
import { assertIsDebugConfig, IpykernelCheckResult, isUsingIpykernel6OrLater } from './helper';
import { Debugger } from './debugger';
import { IpyKernelNotInstalledError } from '../../datascience/errors/ipyKernelNotInstalledError';

/**
 * The DebuggingManager maintains the mapping between notebook documents and debug sessions.
 */
@injectable()
export class DebuggingManager implements IExtensionSingleActivationService, IDebuggingManager, IDisposable {
    private debuggingInProgress: ContextKey;
    private runByLineInProgress: ContextKey;
    private notebookToDebugger = new Map<NotebookDocument, Debugger>();
    private notebookToDebugAdapter = new Map<NotebookDocument, KernelDebugAdapter>();
    private notebookToRunByLineController = new Map<NotebookDocument, RunByLineController>();
    private notebookInProgress = new Set<NotebookDocument>();
    private readonly disposables: IDisposable[] = [];
    private _doneDebugging = new EventEmitter<void>();

    public constructor(
        @inject(IKernelProvider) private kernelProvider: IKernelProvider,
        @inject(INotebookControllerManager) private readonly notebookControllerManager: INotebookControllerManager,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IVSCodeNotebook) private readonly vscNotebook: IVSCodeNotebook,
        @inject(IFileSystem) private fs: IFileSystem,
        @inject(IConfigurationService) private settings: IConfigurationService
    ) {
        this.debuggingInProgress = new ContextKey(EditorContexts.DebuggingInProgress, this.commandManager);
        this.runByLineInProgress = new ContextKey(EditorContexts.RunByLineInProgress, this.commandManager);
        this.updateToolbar(false);
        this.updateCellToolbar(false);

        this.disposables.push(
            this.vscNotebook.onDidChangeActiveNotebookEditor(
                (e?: NotebookEditor) => {
                    if (e) {
                        this.updateCellToolbar(this.isDebugging(e.document));
                        this.updateToolbar(this.isDebugging(e.document));
                    }
                },
                this,
                this.disposables
            )
        );
    }

    public async activate() {
        this.disposables.push(
            // track termination of debug sessions
            debug.onDidTerminateDebugSession(this.endSession.bind(this)),

            // track closing of notebooks documents
            workspace.onDidCloseNotebookDocument(async (document) => {
                const dbg = this.notebookToDebugger.get(document);
                if (dbg) {
                    await dbg.stop();
                    this.updateToolbar(false);
                    this.updateCellToolbar(false);
                }
            }),

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
                        cell = editor?.document.cellAt(range.start);
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
                        cell = editor?.document.cellAt(range.start);
                    }
                }

                if (!cell) {
                    return;
                }

                if (this.notebookInProgress.has(cell.notebook)) {
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
                    const controller = this.notebookToRunByLineController.get(editor.document);
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
                        cell = editor?.document.cellAt(range.start);
                    }
                }

                if (!cell) {
                    return;
                }

                await this.tryToStartDebugging(KernelDebugMode.Cell, editor, cell);
            })
        );
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

    public getDebugMode(notebook: NotebookDocument): KernelDebugMode | undefined {
        const controller = this.notebookToRunByLineController.get(notebook);
        return controller?.getMode();
    }

    public getDebugCell(notebook: NotebookDocument): NotebookCell | undefined {
        const controller = this.notebookToRunByLineController.get(notebook);
        return controller?.debugCell;
    }

    public getDebugAdapter(notebook: NotebookDocument): KernelDebugAdapter | undefined {
        return this.notebookToDebugAdapter.get(notebook);
    }

    private updateToolbar(debugging: boolean) {
        this.debuggingInProgress.set(debugging).ignoreErrors();
    }

    private updateCellToolbar(runningByLine: boolean) {
        this.runByLineInProgress.set(runningByLine).ignoreErrors();
    }

    private async tryToStartDebugging(mode: KernelDebugMode, editor?: NotebookEditor, cell?: NotebookCell) {
        if (!editor) {
            void this.appShell.showErrorMessage(DataScience.noNotebookToDebug());
            return;
        }

        if (this.notebookInProgress.has(editor.document)) {
            return;
        }

        if (this.isDebugging(editor.document)) {
            this.updateToolbar(true);
            if (mode === KernelDebugMode.RunByLine) {
                this.updateCellToolbar(true);
            }
            return;
        }

        const checkIpykernelAndStart = async (allowSelectKernel = true): Promise<void> => {
            const ipykernelResult = await this.checkForIpykernel6(editor.document);
            switch (ipykernelResult) {
                case IpykernelCheckResult.NotInstalled:
                    // User would have been notified about this, nothing more to do.
                    return;
                case IpykernelCheckResult.Outdated:
                case IpykernelCheckResult.Unknown: {
                    void this.promptInstallIpykernel6();
                    return;
                }
                case IpykernelCheckResult.Ok: {
                    switch (mode) {
                        case KernelDebugMode.Everything: {
                            await this.startDebugging(editor.document);
                            this.updateToolbar(true);
                            return;
                        }
                        case KernelDebugMode.Cell:
                            if (cell) {
                                await this.startDebuggingCell(editor.document, KernelDebugMode.Cell, cell);
                                this.updateToolbar(true);
                            }
                            return;
                        case KernelDebugMode.RunByLine:
                            if (cell) {
                                await this.startDebuggingCell(editor.document, KernelDebugMode.RunByLine, cell);
                                this.updateToolbar(true);
                                this.updateCellToolbar(true);
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
            this.notebookInProgress.add(editor.document);
            await checkIpykernelAndStart();
        } finally {
            this.notebookInProgress.delete(editor.document);
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

    private async startDebuggingConfig(
        doc: NotebookDocument,
        config: IKernelDebugAdapterConfig,
        options?: DebugSessionOptions
    ) {
        let dbg = this.notebookToDebugger.get(doc);
        if (!dbg) {
            dbg = new Debugger(doc, config, options);
            this.notebookToDebugger.set(doc, dbg);

            try {
                await dbg.session;
            } catch (err) {
                traceError(`Can't start debugging (${err})`);
                void this.appShell.showErrorMessage(DataScience.cantStartDebugging());
            }
        }
    }

    private async endSession(session: DebugSession) {
        this._doneDebugging.fire();
        for (const [doc, dbg] of this.notebookToDebugger.entries()) {
            if (dbg && session.id === (await dbg.session).id) {
                this.notebookToDebugger.delete(doc);
                this.notebookToDebugAdapter.delete(doc);
                this.updateToolbar(false);
                this.updateCellToolbar(false);
                break;
            }
        }
    }

    private async createDebugAdapterDescriptor(session: DebugSession): Promise<DebugAdapterDescriptor | undefined> {
        const config = session.configuration;
        assertIsDebugConfig(config);

        if (this.vscNotebook.activeNotebookEditor) {
            const activeDoc = this.vscNotebook.activeNotebookEditor.document;

            // TODO we apparently always have a kernel here, clean up typings
            const kernel = await this.ensureKernelIsRunning(activeDoc);
            const debug = this.getDebuggerByUri(activeDoc);

            if (debug) {
                if (kernel?.session) {
                    debug.resolve(session);
                    const adapter = new KernelDebugAdapter(session, debug.document, kernel.session, this.fs, kernel);

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
                    } else if (config.__mode === KernelDebugMode.Cell && typeof config.__cellIndex === 'number') {
                        const cell = activeDoc.cellAt(config.__cellIndex);
                        const controller = new DebugCellController(adapter, cell, kernel!, this.commandManager);
                        adapter.setDebuggingDelegate(controller);
                    }

                    this.notebookToDebugAdapter.set(debug.document, adapter);
                    this.disposables.push(adapter.onDidEndSession(this.endSession.bind(this)));
                    return new DebugAdapterInlineImplementation(adapter);
                } else {
                    void this.appShell.showInformationMessage(DataScience.kernelWasNotStarted());
                }
            }
        }
        traceError('Debug sessions should start only from the cell toolbar command');
        return;
    }

    private getDebuggerByUri(document: NotebookDocument): Debugger | undefined {
        for (const [doc, dbg] of this.notebookToDebugger.entries()) {
            if (document === doc) {
                return dbg;
            }
        }
    }

    private async ensureKernelIsRunning(doc: NotebookDocument): Promise<IKernel | undefined> {
        await this.notebookControllerManager.loadNotebookControllers();
        const controller = this.notebookControllerManager.getSelectedNotebookController(doc);

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

    private async checkForIpykernel6(doc: NotebookDocument): Promise<IpykernelCheckResult> {
        try {
            let kernel = this.kernelProvider.get(doc);
            if (!kernel) {
                const controller = this.notebookControllerManager.getSelectedNotebookController(doc);
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
            if (ex instanceof IpyKernelNotInstalledError) {
                return IpykernelCheckResult.NotInstalled;
            }
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
