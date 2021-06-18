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
                    const debug = await this.getDebuggerByUri(activeDoc);

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
                            vscode.window.showInformationMessage('run the kernel');
                            // dbg.reject(new Error('Kernel appears to have been stopped'));
                        }
                    }
                    // should not happen
                    return;
                }
            }),

            vscode.commands.registerCommand('david.toggleDebugging', () => {
                const editor = vscode.window.activeNotebookEditor;
                if (editor) {
                    this.toggleDebugging(editor.document);
                } else {
                    vscode.window.showErrorMessage('No active notebook document to debug');
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

    private async toggleDebugging(doc: vscode.NotebookDocument) {
        let dbg = this.notebookToDebugger.get(doc);
        if (dbg) {
            await dbg.stop();
            this.notebookToDebugger.delete(doc);
        } else {
            dbg = new Debugger(doc);
            this.notebookToDebugger.set(doc, dbg);
            await this.kernelProvider.get(doc.uri); // ensure the kernel is running
            try {
                await dbg.session;
            } catch (err) {
                vscode.window.showErrorMessage(`Can't start debugging (${err})`);
            }
        }
    }

    private async getDebuggerByUri(document: vscode.NotebookDocument): Promise<Debugger> {
        for (const [doc, dbg] of this.notebookToDebugger.entries()) {
            if (document.uri.toString() === doc.uri.toString()) {
                return dbg;
            }
        }

        const dbg = new Debugger(document);
        this.notebookToDebugger.set(document, dbg);
        await this.kernelProvider.get(document.uri); // ensure the kernel is running
        // try {
        //     await dbg.session;
        // } catch (err) {
        //     vscode.window.showErrorMessage(`Can't start debugging (${err})`);
        // }
        return dbg;
    }
}

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
        vscode.debug.stopDebugging(await this.session);
    }
}
