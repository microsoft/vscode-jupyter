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
    Event,
    NotebookCell,
    DebugSessionOptions,
    DebugConfiguration,
    EventEmitter,
    DebugProtocolMessage
} from 'vscode';
import * as path from 'path';
import { IKernel, IKernelProvider } from '../../datascience/jupyter/kernels/types';
import { IDisposable, IInstaller, Product, ProductInstallStatus } from '../../common/types';
import { IKernelDebugAdapterConfig, KernelDebugAdapter, KernelDebugMode } from './kernelDebugAdapter';
import { INotebookProvider } from '../../datascience/types';
import { IExtensionSingleActivationService } from '../../activation/types';
import { ServerStatus } from '../../../datascience-ui/interactive-common/mainState';
import { INotebookControllerManager } from '../../datascience/notebook/types';
import { ContextKey } from '../../common/contextKey';
import { EditorContexts } from '../../datascience/constants';
import { IApplicationShell, ICommandManager, IVSCodeNotebook } from '../../common/application/types';
import { traceError } from '../../common/logger';
import { DataScience } from '../../common/utils/localize';
import { Commands as DSCommands } from '../../datascience/constants';
import { IFileSystem } from '../../common/platform/types';
import { IDebuggingManager } from '../types';
import { DebugProtocol } from 'vscode-debugprotocol';
import { pythonKernelDebugAdapter } from '../constants';
import { IPythonInstaller } from '../../api/types';

class Debugger {
    private resolveFunc?: (value: DebugSession) => void;
    private rejectFunc?: (reason?: Error) => void;

    readonly session: Promise<DebugSession>;

    constructor(
        public readonly document: NotebookDocument,
        public readonly config: DebugConfiguration,
        options?: DebugSessionOptions
    ) {
        this.session = new Promise<DebugSession>((resolve, reject) => {
            this.resolveFunc = resolve;
            this.rejectFunc = reject;

            debug.startDebugging(undefined, config, options).then(undefined, reject);
        });
    }

    resolve(session: DebugSession) {
        if (this.resolveFunc) {
            this.resolveFunc(session);
        }
    }

    reject(reason: Error) {
        if (this.rejectFunc) {
            this.rejectFunc(reason);
        }
    }

    async stop() {
        void debug.stopDebugging(await this.session);
    }
}

/**
 * The DebuggingManager maintains the mapping between notebook documents and debug sessions.
 */
@injectable()
export class DebuggingManager implements IExtensionSingleActivationService, IDebuggingManager, IDisposable {
    private debuggingInProgress: ContextKey;
    private runByLineInProgress: ContextKey;
    private notebookToDebugger = new Map<NotebookDocument, Debugger>();
    private notebookToDebugAdapter = new Map<NotebookDocument, KernelDebugAdapter>();
    private readonly disposables: IDisposable[] = [];
    private readonly _onDidFireVariablesEvent = new EventEmitter<void>();

    public constructor(
        @inject(IKernelProvider) private kernelProvider: IKernelProvider,
        @inject(INotebookProvider) private notebookProvider: INotebookProvider,
        @inject(INotebookControllerManager) private readonly notebookControllerManager: INotebookControllerManager,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IVSCodeNotebook) private readonly vscNotebook: IVSCodeNotebook,
        @inject(IFileSystem) private fs: IFileSystem,
        @inject(IPythonInstaller) private pythonInstaller: IPythonInstaller,
        @inject(IInstaller) private readonly installer: IInstaller
    ) {
        this.debuggingInProgress = new ContextKey(EditorContexts.DebuggingInProgress, this.commandManager);
        this.runByLineInProgress = new ContextKey(EditorContexts.RunByLineInProgress, this.commandManager);
        this.updateToolbar(false);
        this.updateCellToolbar(false);
    }

    public get onDidFireVariablesEvent(): Event<void> {
        return this._onDidFireVariablesEvent.event;
    }

    public async activate() {
        this.disposables.push(
            // track termination of debug sessions
            debug.onDidTerminateDebugSession(this.endSession.bind(this)),

            // track closing of notebooks documents
            workspace.onDidCloseNotebookDocument(async (document) => {
                const dbg = this.notebookToDebugger.get(document);
                if (dbg) {
                    this.updateToolbar(false);
                    this.updateCellToolbar(false);
                    await dbg.stop();
                }
            }),

            // factory for kernel debug adapters
            debug.registerDebugAdapterDescriptorFactory(pythonKernelDebugAdapter, {
                createDebugAdapterDescriptor: async (session) => {
                    if (this.vscNotebook.activeNotebookEditor) {
                        const activeDoc = this.vscNotebook.activeNotebookEditor.document;

                        const kernel = await this.ensureKernelIsRunning(activeDoc);
                        const debug = this.getDebuggerByUri(activeDoc);

                        if (debug) {
                            const notebook = await this.notebookProvider.getOrCreateNotebook({
                                resource: debug.document.uri,
                                identity: debug.document.uri,
                                getOnly: true
                            });
                            if (notebook && notebook.session) {
                                debug.resolve(session);
                                const adapter = new KernelDebugAdapter(
                                    session,
                                    debug.document,
                                    notebook.session,
                                    this.commandManager,
                                    this.fs,
                                    kernel
                                );
                                this.disposables.push(
                                    adapter.onDidSendMessage((msg: DebugProtocolMessage) => {
                                        if ((msg as DebugProtocol.VariablesResponse).command === 'variables') {
                                            this._onDidFireVariablesEvent.fire();
                                        }
                                    }),
                                    adapter.onDidEndSession(this.endSession.bind(this))
                                );
                                this.notebookToDebugAdapter.set(debug.document, adapter);
                                return new DebugAdapterInlineImplementation(adapter);
                            } else {
                                void this.appShell.showInformationMessage(DataScience.kernelWasNotStarted());
                            }
                        }
                    }
                    traceError('Debug sessions should start only from the cell toolbar command');
                    return;
                }
            }),

            this.commandManager.registerCommand(DSCommands.DebugNotebook, async () => {
                const editor = this.vscNotebook.activeNotebookEditor;
                if (editor) {
                    if (await this.checkForIpykernel6(editor.document)) {
                        this.updateToolbar(true);
                        void this.startDebugging(editor.document);
                    } else {
                        void this.installIpykernel6(editor.document);
                    }
                } else {
                    void this.appShell.showErrorMessage(DataScience.noNotebookToDebug());
                }
            }),

            this.commandManager.registerCommand(DSCommands.RunByLine, async (cell: NotebookCell) => {
                const editor = this.vscNotebook.activeNotebookEditor;
                if (editor) {
                    if (await this.checkForIpykernel6(editor.document)) {
                        this.updateToolbar(true);
                        this.updateCellToolbar(true);
                        void this.startDebuggingCell(editor.document, KernelDebugMode.RunByLine, cell);
                    } else {
                        void this.installIpykernel6(editor.document);
                    }
                } else {
                    void this.appShell.showErrorMessage(DataScience.noNotebookToDebug());
                }
            }),

            this.commandManager.registerCommand(DSCommands.RunByLineContinue, (cell: NotebookCell) => {
                const adapter = this.notebookToDebugAdapter.get(cell.notebook);
                if (adapter && adapter.debugCellUri?.toString() === cell.document.uri.toString()) {
                    adapter.runByLineContinue();
                }
            }),

            this.commandManager.registerCommand(DSCommands.RunAndDebugCell, async (cell: NotebookCell | undefined) => {
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

                if (editor) {
                    if (await this.checkForIpykernel6(editor.document)) {
                        this.updateToolbar(true);
                        void this.startDebuggingCell(editor.document, KernelDebugMode.Cell, cell);
                    } else {
                        void this.installIpykernel6(editor.document);
                    }
                } else {
                    void this.appShell.showErrorMessage(DataScience.noNotebookToDebug());
                }
            })
        );
    }

    public dispose() {
        this.disposables.forEach((d) => d.dispose());
    }

    public getDebugSession(notebook: NotebookDocument): DebugSession | undefined {
        const adapter = this.notebookToDebugAdapter.get(notebook);
        if (adapter) {
            return adapter.debugSession;
        }
    }

    private updateToolbar(debugging: boolean) {
        this.debuggingInProgress.set(debugging).ignoreErrors();
    }

    private updateCellToolbar(runningByLine: boolean) {
        this.runByLineInProgress.set(runningByLine).ignoreErrors();
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
            internalConsoleOptions: 'neverOpen',
            justMyCode: true,
            // add a property to the config to know if the session is runByLine
            __mode: mode,
            __cellIndex: cell.index
        };
        const opts = mode === KernelDebugMode.RunByLine ? { debugUI: { simple: true } } : undefined;
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
        void this.updateToolbar(false);
        void this.updateCellToolbar(false);
        for (const [doc, dbg] of this.notebookToDebugger.entries()) {
            if (dbg && session.id === (await dbg.session).id) {
                this.notebookToDebugger.delete(doc);
                break;
            }
        }
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
        if (kernel && kernel.status === ServerStatus.NotStarted) {
            await kernel.start({ document: doc });
        }

        return kernel;
    }

    private async checkForIpykernel6(doc: NotebookDocument): Promise<boolean> {
        try {
            const controller = this.notebookControllerManager.getSelectedNotebookController(doc);
            const result = await this.pythonInstaller.isProductVersionCompatible(
                Product.ipykernel,
                '>=6.0.0',
                controller?.connection.interpreter
            );

            return result === ProductInstallStatus.Installed;
        } catch {
            return false;
        }
    }

    private async installIpykernel6(doc: NotebookDocument) {
        const response = await this.appShell.showInformationMessage(
            DataScience.needIpykernel6(),
            { modal: true },
            DataScience.jupyterInstall()
        );

        if (response === DataScience.jupyterInstall()) {
            const controller = this.notebookControllerManager.getSelectedNotebookController(doc);
            void this.installer.install(Product.ipykernel, controller?.connection.interpreter, undefined, true);
        }
    }
}
