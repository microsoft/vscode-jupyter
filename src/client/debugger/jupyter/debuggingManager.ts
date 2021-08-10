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
    DebugProtocolMessage,
    DebugAdapterTracker,
    DebugAdapterTrackerFactory,
    Disposable
} from 'vscode';
import * as path from 'path';
import { IKernelProvider } from '../../datascience/jupyter/kernels/types';
import { IDisposable } from '../../common/types';
import { KernelDebugAdapter } from './kernelDebugAdapter';
import { IDebuggingCellMap, INotebookProvider } from '../../datascience/types';
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
import { noop } from '../../common/utils/misc';
import { pythonKernelDebugAdapter } from '../constants';

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
    private debugAdapterTrackerFactories: DebugAdapterTrackerFactory[] = [];
    private debugAdapterTrackers: DebugAdapterTracker[] = [];

    public constructor(
        @inject(IKernelProvider) private kernelProvider: IKernelProvider,
        @inject(INotebookProvider) private notebookProvider: INotebookProvider,
        @inject(IDebuggingCellMap) private debuggingCellMap: IDebuggingCellMap,
        @inject(INotebookControllerManager) private readonly notebookControllerManager: INotebookControllerManager,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IVSCodeNotebook) private readonly vscNotebook: IVSCodeNotebook,
        @inject(IFileSystem) private fs: IFileSystem
    ) {
        this.debuggingInProgress = new ContextKey(EditorContexts.DebuggingInProgress, this.commandManager);
        this.runByLineInProgress = new ContextKey(EditorContexts.RunByLineInProgress, this.commandManager);
        this.updateToolbar(false);
        this.updateCellToolbar(false);
    }

    public get onDidFireVariablesEvent(): Event<void> {
        return this._onDidFireVariablesEvent.event;
    }

    public registerDebugAdapterTrackerFactory(_debugType: string, provider: DebugAdapterTrackerFactory): Disposable {
        this.debugAdapterTrackerFactories.push(provider);
        return {
            dispose: () => {
                this.debugAdapterTrackerFactories = this.debugAdapterTrackerFactories.filter((f) => f !== provider);
            }
        };
    }

    public async activate() {
        this.disposables.push(
            // track termination of debug sessions
            debug.onDidTerminateDebugSession(async (session) => {
                this.updateToolbar(false);
                this.updateCellToolbar(false);
                this.debugAdapterTrackers.forEach((d) => (d.onExit ? d.onExit(0, undefined) : noop()));
                this.debugAdapterTrackers = [];
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
            debug.registerDebugAdapterDescriptorFactory(pythonKernelDebugAdapter, {
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
                                        if ((msg as DebugProtocol.VariablesResponse).command === 'variables') {
                                            this._onDidFireVariablesEvent.fire();
                                        }
                                        switch ((msg as DebugProtocol.ProtocolMessage).type) {
                                            case 'request':
                                                this.debugAdapterTrackers.forEach((d) => {
                                                    if (d.onWillReceiveMessage) {
                                                        d.onWillReceiveMessage(msg);
                                                    }
                                                });
                                                break;
                                            case 'response':
                                                this.debugAdapterTrackers.forEach((d) => d.onDidSendMessage!(msg));
                                                break;
                                            default:
                                                break;
                                        }
                                    })
                                );
                                this.notebookToDebugAdapter.set(debug.document, adapter);
                                // Create our debug adapter trackers at session start
                                this.debugAdapterTrackers = this.debugAdapterTrackerFactories.map(
                                    (f) => f.createDebugAdapterTracker(session) as DebugAdapterTracker
                                );
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

    private async startDebugging(doc: NotebookDocument, cell?: NotebookCell, options?: DebugSessionOptions) {
        let dbg = this.notebookToDebugger.get(doc);
        if (!dbg) {
            const config: DebugConfiguration = {
                type: pythonKernelDebugAdapter,
                name: path.basename(doc.uri.toString()),
                request: 'attach',
                internalConsoleOptions: 'neverOpen',
                justMyCode: cell ? true : false,
                // add the doc uri to the config
                __document: doc.uri.toString(),
                // add a property to the config to know if the session is runByLine
                __runByLine: cell ? true : false,
                // if the debugger was called from a cell, add it
                __cellIndex: cell ? cell.index : undefined
            };
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
                controller: controller?.controller,
                resourceUri: doc.uri
            });
        }
        if (kernel && kernel.status === ServerStatus.NotStarted) {
            await kernel.start({ document: doc });
        }
    }
}
