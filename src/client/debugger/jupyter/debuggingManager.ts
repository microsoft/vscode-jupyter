// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable, named } from 'inversify';
import {
    debug,
    NotebookDocument,
    workspace,
    DebugAdapterInlineImplementation,
    DebugSession,
    NotebookCell,
    DebugSessionOptions,
    DebugAdapterTrackerFactory,
    DebugAdapterTracker,
    ProviderResult,
    DebugConfiguration,
    DebugProtocolMessage
} from 'vscode';
import * as path from 'path';
import { IKernelProvider } from '../../datascience/jupyter/kernels/types';
import { IDisposable } from '../../common/types';
import { KernelDebugAdapter } from './kernelDebugAdapter';
import { IDebuggingCellMap, IJupyterDebugService, INotebookProvider } from '../../datascience/types';
import { IExtensionSingleActivationService } from '../../activation/types';
import { ServerStatus } from '../../../datascience-ui/interactive-common/mainState';
import { INotebookControllerManager } from '../../datascience/notebook/types';
import { ContextKey } from '../../common/contextKey';
import { EditorContexts, Identifiers } from '../../datascience/constants';
import { IApplicationShell, ICommandManager, IVSCodeNotebook } from '../../common/application/types';
import { traceError } from '../../common/logger';
import { DataScience } from '../../common/utils/localize';
import { Commands as DSCommands } from '../../datascience/constants';
import { IFileSystem } from '../../common/platform/types';
import { DebugLocationTracker } from '../../datascience/debugLocationTracker';

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
export class DebuggingManager implements IExtensionSingleActivationService, DebugAdapterTrackerFactory, IDisposable {
    private debuggingInProgress: ContextKey;
    private runByLineInProgress: ContextKey;
    private notebookToDebugger = new Map<NotebookDocument, Debugger>();
    private notebookToDebugAdapter = new Map<NotebookDocument, KernelDebugAdapter>();
    private activeTrackers: Map<string, DebugLocationTracker> = new Map<string, DebugLocationTracker>();
    private readonly disposables: IDisposable[] = [];

    public constructor(
        @inject(IKernelProvider) private kernelProvider: IKernelProvider,
        @inject(INotebookProvider) private notebookProvider: INotebookProvider,
        @inject(IDebuggingCellMap) private debuggingCellMap: IDebuggingCellMap,
        @inject(INotebookControllerManager) private readonly notebookControllerManager: INotebookControllerManager,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IVSCodeNotebook) private readonly vscNotebook: IVSCodeNotebook,
        @inject(IFileSystem) private fs: IFileSystem,
        @inject(IJupyterDebugService)
        @named(Identifiers.MULTIPLEXING_DEBUGSERVICE)
        private debugService: IJupyterDebugService
    ) {
        this.debuggingInProgress = new ContextKey(EditorContexts.DebuggingInProgress, this.commandManager);
        this.runByLineInProgress = new ContextKey(EditorContexts.RunByLineInProgress, this.commandManager);
        this.updateToolbar(false);
        this.updateCellToolbar(false);
    }

    public async activate() {
        this.disposables.push(
            // track termination of debug sessions
            debug.onDidTerminateDebugSession(async (session) => {
                this.updateToolbar(false);
                this.updateCellToolbar(false);
                for (const [doc, dbg] of this.notebookToDebugger.entries()) {
                    if (dbg && session === (await dbg.session)) {
                        this.debuggingCellMap.getCellsAnClearQueue(doc);
                        this.notebookToDebugger.delete(doc);
                        break;
                    }
                }
            }),

            // track closing of notebooks documents
            workspace.onDidCloseNotebookDocument(async (document) => {
                this.debuggingCellMap.getCellsAnClearQueue(document);
                const dbg = this.notebookToDebugger.get(document);
                if (dbg) {
                    this.updateToolbar(false);
                    this.updateCellToolbar(false);
                    await dbg.stop();
                }
            }),

            // factory for kernel debug adapters
            debug.registerDebugAdapterDescriptorFactory(DataScience.pythonKernelDebugAdapter(), {
                createDebugAdapterDescriptor: async (session) => {
                    if (this.vscNotebook.activeNotebookEditor) {
                        const activeDoc = this.vscNotebook.activeNotebookEditor.document;

                        await this.ensureKernelIsRunning(activeDoc);
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
                                    this.debuggingCellMap,
                                    this.commandManager,
                                    this.fs
                                );
                                this.disposables.push(
                                    adapter.onDidSendMessage((msg: DebugProtocolMessage) => {
                                        this.debugService.requestKernelDebugAdapterVariables(msg);
                                    })
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

            debug.registerDebugAdapterTrackerFactory(DataScience.pythonKernelDebugAdapter(), this),

            this.commandManager.registerCommand(DSCommands.DebugNotebook, () => {
                const editor = this.vscNotebook.activeNotebookEditor;
                if (editor) {
                    this.updateToolbar(true);
                    void this.startDebugging(editor.document);
                } else {
                    void this.appShell.showErrorMessage(DataScience.noNotebookToDebug());
                }
            }),

            this.commandManager.registerCommand(DSCommands.RunByLine, (cell: NotebookCell) => {
                const editor = this.vscNotebook.activeNotebookEditor;
                if (editor) {
                    this.updateToolbar(true);
                    this.updateCellToolbar(true);
                    void this.startDebugging(editor.document, cell, { debugUI: { simple: true } });
                } else {
                    void this.appShell.showErrorMessage(DataScience.noNotebookToDebug());
                }
            }),

            this.commandManager.registerCommand(DSCommands.RunByLineContinue, (cell: NotebookCell) => {
                const adapter = this.notebookToDebugAdapter.get(cell.notebook);
                if (adapter) {
                    adapter.runByLineContinue();
                } else {
                    void this.appShell.showErrorMessage(DataScience.noNotebookToDebug());
                }
            }),

            this.commandManager.registerCommand(DSCommands.RunByLineStop, (cell: NotebookCell) => {
                const adapter = this.notebookToDebugAdapter.get(cell.notebook);
                if (adapter) {
                    adapter.runByLineStop();
                } else {
                    void this.appShell.showErrorMessage(DataScience.noNotebookToDebug());
                }
            })
        );
    }

    public createDebugAdapterTracker(session: DebugSession): ProviderResult<DebugAdapterTracker> {
        const result = new DebugLocationTracker(session.id);
        this.activeTrackers.set(session.id, result);
        result.sessionEnded(this.onSessionEnd.bind(this));
        // result.debugLocationUpdated(this.onLocationUpdated.bind(this));
        // this.onLocationUpdated();
        return result;
    }

    public dispose() {
        this.disposables.forEach((d) => d.dispose());
    }

    private onSessionEnd(locationTracker: DebugLocationTracker) {
        if (locationTracker.sessionId) {
            this.activeTrackers.delete(locationTracker.sessionId);
        }
    }

    private updateToolbar(debugging: boolean) {
        this.debuggingInProgress.set(debugging).ignoreErrors();
    }

    private updateCellToolbar(runningByLine: boolean) {
        this.runByLineInProgress.set(runningByLine).ignoreErrors();
    }

    private async startDebugging(doc: NotebookDocument, cell?: NotebookCell, options?: DebugSessionOptions) {
        let dbg = this.notebookToDebugger.get(doc);
        if (!dbg) {
            const name = cell
                ? `${path.basename(doc.uri.toString())}?RBL=${cell.index}`
                : path.basename(doc.uri.toString());
            const justMyCode = cell ? true : false;
            const config: DebugConfiguration = {
                type: DataScience.pythonKernelDebugAdapter(),
                name: name,
                request: 'attach',
                internalConsoleOptions: 'neverOpen',
                justMyCode: justMyCode,
                __document: doc.uri.toString()
            };
            dbg = new Debugger(doc, config, options);
            this.notebookToDebugger.set(doc, dbg);

            try {
                const session = await dbg.session;
                this.debugService.startKernelDebugAdapterSession(session);

                if (!cell) {
                    // toggle the breakpoint margin
                    void this.commandManager.executeCommand('notebook.toggleBreakpointMargin', doc);
                }
            } catch (err) {
                traceError(`Can't start debugging (${err})`);
                void this.appShell.showErrorMessage(DataScience.cantStartDebugging());
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

    private async ensureKernelIsRunning(doc: NotebookDocument): Promise<void> {
        await this.notebookControllerManager.loadNotebookControllers();
        const controller = this.notebookControllerManager.getSelectedNotebookController(doc);

        let kernel = this.kernelProvider.get(doc);
        if (!kernel && controller) {
            kernel = this.kernelProvider.getOrCreate(doc, {
                metadata: controller.connection,
                controller: controller?.controller
            });
        }
        if (kernel && kernel.status === ServerStatus.NotStarted) {
            await kernel.start({ document: doc });
        }
    }
}
