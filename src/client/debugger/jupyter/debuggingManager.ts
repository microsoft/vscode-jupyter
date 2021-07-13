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
    NotebookCell
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

class Debugger {
    private resolveFunc?: (value: DebugSession) => void;
    private rejectFunc?: (reason?: Error) => void;

    readonly session: Promise<DebugSession>;

    constructor(public readonly document: NotebookDocument) {
        this.session = new Promise<DebugSession>((resolve, reject) => {
            this.resolveFunc = resolve;
            this.rejectFunc = reject;

            debug
                .startDebugging(undefined, {
                    type: DataScience.pythonKernelDebugAdapter(),
                    name: `${path.basename(document.uri.toString())}`,
                    request: 'attach',
                    internalConsoleOptions: 'neverOpen',
                    __document: document.uri.toString()
                })
                .then(undefined, reject);
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
export class DebuggingManager implements IExtensionSingleActivationService, IDisposable {
    private debuggingInProgress: ContextKey;
    private notebookToDebugger = new Map<NotebookDocument, Debugger>();
    private readonly disposables: IDisposable[] = [];

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
        this.updateToolbar(false);
    }

    public async activate() {
        this.disposables.push(
            // track termination of debug sessions
            debug.onDidTerminateDebugSession(async (session) => {
                this.updateToolbar(false);
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
                                return new DebugAdapterInlineImplementation(
                                    new KernelDebugAdapter(
                                        session,
                                        debug.document,
                                        notebook.session,
                                        this.debuggingCellMap,
                                        this.commandManager,
                                        this.fs
                                    )
                                );
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

            this.commandManager.registerCommand(DSCommands.RunByLine, (_cell: NotebookCell) => {
                // TODO
            })
        );
    }

    public dispose() {
        this.disposables.forEach((d) => d.dispose());
    }

    private updateToolbar(debugging: boolean) {
        this.debuggingInProgress.set(debugging).ignoreErrors();
    }

    private async startDebugging(doc: NotebookDocument) {
        let dbg = this.notebookToDebugger.get(doc);
        if (!dbg) {
            dbg = new Debugger(doc);
            this.notebookToDebugger.set(doc, dbg);

            try {
                await dbg.session;

                // toggle the breakpoint margin
                void this.commandManager.executeCommand('notebook.toggleBreakpointMargin', doc);
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

        let kernel = this.kernelProvider.get(doc.uri);
        if (!kernel && controller) {
            kernel = this.kernelProvider.getOrCreate(doc.uri, {
                metadata: controller.connection,
                controller: controller?.controller
            });
        }
        if (kernel && kernel.status === ServerStatus.NotStarted) {
            await kernel.start({ document: doc });
        }
    }
}
