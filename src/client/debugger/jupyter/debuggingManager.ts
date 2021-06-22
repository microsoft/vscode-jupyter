// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import * as vscode from 'vscode';
import * as path from 'path';
import { IKernelProvider } from '../../datascience/jupyter/kernels/types';
import { IDisposable } from '../../common/types';
import { KernelDebugAdapter } from './kernelDebugAdapter';
import { INotebookProvider } from '../../datascience/types';
import { IExtensionSingleActivationService } from '../../activation/types';
import { ServerStatus } from '../../../datascience-ui/interactive-common/mainState';

class Debugger {
    private resolveFunc?: (value: vscode.DebugSession) => void;
    private rejectFunc?: (reason?: Error) => void;

    readonly session: Promise<vscode.DebugSession>;

    constructor(public readonly document: vscode.NotebookDocument) {
        this.session = new Promise<vscode.DebugSession>((resolve, reject) => {
            this.resolveFunc = resolve;
            this.rejectFunc = reject;

            vscode.debug
                .startDebugging(undefined, {
                    type: 'kernel',
                    name: `${path.basename(document.uri.toString())}`,
                    request: 'attach',
                    internalConsoleOptions: 'neverOpen',
                    __document: document.uri.toString()
                })
                .then(undefined, reject);
        });
    }

    resolve(session: vscode.DebugSession) {
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
        void vscode.debug.stopDebugging(await this.session);
    }
}

/**
 * The DebuggingManager maintains the mapping between notebook documents and debug sessions.
 */
@injectable()
export class DebuggingManager implements IExtensionSingleActivationService {
    private notebookToDebugger = new Map<vscode.NotebookDocument, Debugger>();
    private readonly disposables: IDisposable[] = [];

    public constructor(
        @inject(IKernelProvider) private kernelProvider: IKernelProvider,
        @inject(INotebookProvider) private notebookProvider: INotebookProvider
    ) {}

    public async activate() {
        vscode.debug.breakpoints; // start to fetch breakpoints

        this.disposables.push(
            // track termination of debug sessions
            vscode.debug.onDidTerminateDebugSession(async (session) => {
                for (const [doc, dbg] of this.notebookToDebugger.entries()) {
                    if (dbg && session === (await dbg.session)) {
                        this.notebookToDebugger.delete(doc);
                        break;
                    }
                }
            }),

            // track closing of notebooks documents
            vscode.workspace.onDidCloseNotebookDocument(async (document) => {
                const dbg = this.notebookToDebugger.get(document);
                if (dbg) {
                    await dbg.stop();
                }
                this.fixBreakpoints(document);
            }),

            // factory for kernel debug adapters
            vscode.debug.registerDebugAdapterDescriptorFactory('kernel', {
                createDebugAdapterDescriptor: async (session) => {
                    const activeDoc = vscode.window.activeNotebookEditor!.document;
                    // ensure the kernel is running
                    const kernel = this.kernelProvider.get(activeDoc.uri);
                    if (kernel && kernel.status === ServerStatus.NotStarted) {
                        await kernel.start({ document: activeDoc });
                    }

                    const debug = this.getDebuggerByUri(activeDoc);

                    if (debug) {
                        const notebook = await this.notebookProvider.getOrCreateNotebook({
                            resource: debug.document.uri,
                            identity: debug.document.uri,
                            getOnly: true
                        });
                        if (notebook && notebook.session) {
                            debug.resolve(session);
                            return new vscode.DebugAdapterInlineImplementation(
                                new KernelDebugAdapter(session, debug.document, notebook.session)
                            );
                        } else {
                            void vscode.window.showInformationMessage('run the kernel');
                        }
                    }
                    // Should not happen, debug sessions should start only from the cell toolbar command
                    return;
                }
            }),

            vscode.commands.registerCommand('jupyter.debugCell', () => {
                const editor = vscode.window.activeNotebookEditor;
                if (editor) {
                    void this.startDebugging(editor.document);
                } else {
                    void vscode.window.showErrorMessage('No active notebook document to debug');
                }
            })
        );
    }

    private fixBreakpoints(doc: vscode.NotebookDocument) {
        const map = new Map<string, vscode.Uri>();

        doc.getCells().forEach((cell, ix) => {
            const pos = parseInt(cell.document.uri.fragment);
            if (pos !== ix) {
                map.set(
                    cell.document.uri.toString(),
                    cell.document.uri.with({ fragment: ix.toString().padStart(8, '0') })
                );
            }
        });

        if (map.size > 0) {
            const addBpts: vscode.SourceBreakpoint[] = [];
            const removeBpt: vscode.SourceBreakpoint[] = [];
            for (const b of vscode.debug.breakpoints) {
                if (b instanceof vscode.SourceBreakpoint) {
                    const s = map.get(b.location.uri.toString());
                    if (s) {
                        removeBpt.push(b);
                        const loc = new vscode.Location(s, b.location.range);
                        addBpts.push(
                            new vscode.SourceBreakpoint(loc /*, b.enabled, b.condition, b.hitCondition, b.logMessage*/)
                        );
                    }
                }
            }
            if (removeBpt.length > 0) {
                vscode.debug.removeBreakpoints(removeBpt);
            }
            if (addBpts.length > 0) {
                vscode.debug.addBreakpoints(addBpts);
            }
        }
    }

    private async startDebugging(doc: vscode.NotebookDocument) {
        let dbg = this.notebookToDebugger.get(doc);
        if (!dbg) {
            dbg = new Debugger(doc);
            this.notebookToDebugger.set(doc, dbg);

            try {
                await dbg.session;

                // toggle the breakpoint margin
                void vscode.commands.executeCommand('notebook.toggleBreakpointMargin', doc);
            } catch (err) {
                void vscode.window.showErrorMessage(`Can't start debugging (${err})`);
            }
        }
    }

    private getDebuggerByUri(document: vscode.NotebookDocument): Debugger | undefined {
        for (const [doc, dbg] of this.notebookToDebugger.entries()) {
            if (document.uri.toString() === doc.uri.toString()) {
                return dbg;
            }
        }
    }
}
