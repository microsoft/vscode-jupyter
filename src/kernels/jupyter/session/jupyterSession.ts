// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import * as nbformat from '@jupyterlab/nbformat';
import type { ContentsManager, Kernel, KernelSpecManager, Session, SessionManager } from '@jupyterlab/services';
import * as uuid from 'uuid/v4';
import { CancellationToken, CancellationTokenSource } from 'vscode-jsonrpc';
import { Cancellation } from '../../../platform/common/cancellation';
import { BaseError } from '../../../platform/errors/types';
import { traceVerbose, traceError, traceInfo } from '../../../platform/logging';
import { Resource, IOutputChannel, IDisplayOptions } from '../../../platform/common/types';
import { waitForCondition } from '../../../platform/common/utils/async';
import { DataScience } from '../../../platform/common/utils/localize';
import { JupyterInvalidKernelError } from '../../../platform/errors/jupyterInvalidKernelError';
import { SessionDisposedError } from '../../../platform/errors/sessionDisposedError';
import { captureTelemetry } from '../../../telemetry';
import { Telemetry } from '../../../webviews/webview-side/common/constants';
import { BaseJupyterSession, JupyterSessionStartError } from '../../common/baseJupyterSession';
import { getNameOfKernelConnection } from '../../helpers';
import {
    KernelConnectionMetadata,
    isLocalConnection,
    IJupyterConnection,
    ISessionWithSocket,
    KernelActionSource,
    IJupyterServerSession
} from '../../types';
import { DisplayOptions } from '../../displayOptions';
import { IBackupFile, IJupyterBackingFileCreator, IJupyterKernelService, IJupyterRequestCreator } from '../types';
import {
    NotebookCell,
    NotebookCellData,
    NotebookCellKind,
    NotebookData,
    NotebookDocument,
    Uri,
    workspace
} from 'vscode';
import { generateBackingIPyNbFileName } from './backingFileCreator.base';

// function is
export class JupyterSession extends BaseJupyterSession implements IJupyterServerSession {
    public override readonly kind: 'remoteJupyter' | 'localJupyter';
    private backingFile: IBackupFile | undefined;

    constructor(
        resource: Resource,
        private connInfo: IJupyterConnection,
        kernelConnectionMetadata: KernelConnectionMetadata,
        private specsManager: KernelSpecManager,
        private sessionManager: SessionManager,
        private contentsManager: ContentsManager,
        private readonly outputChannel: IOutputChannel,
        override readonly workingDirectory: Uri,
        private readonly idleTimeout: number,
        private readonly kernelService: IJupyterKernelService | undefined,
        interruptTimeout: number,
        private readonly backingFileCreator: IJupyterBackingFileCreator,
        private readonly requestCreator: IJupyterRequestCreator,
        private readonly sessionCreator: KernelActionSource
    ) {
        super(
            connInfo.localLaunch ? 'localJupyter' : 'remoteJupyter',
            resource,
            kernelConnectionMetadata,
            workingDirectory,
            interruptTimeout
        );

        this.kind = connInfo.localLaunch ? 'localJupyter' : 'remoteJupyter';
    }

    public override isServerSession(): this is IJupyterServerSession {
        return true;
    }

    @captureTelemetry(Telemetry.WaitForIdleJupyter, undefined, true)
    public waitForIdle(timeout: number): Promise<void> {
        // Wait for idle on this session
        return this.waitForIdleOnSession(this.session, timeout);
    }

    public override async shutdown(): Promise<void> {
        await this.disposeBackingFile();
        await super.shutdown();
    }

    public override get kernel(): Kernel.IKernelConnection | undefined {
        return this.session?.kernel || undefined;
    }

    public get kernelId(): string {
        return this.session?.kernel?.id || '';
    }

    public async connect(options: { token: CancellationToken; ui: IDisplayOptions }): Promise<void> {
        // Start a new session
        this.setSession(await this.createNewKernelSession(options));

        // Listen for session status changes
        this.session?.statusChanged.connect(this.statusHandler); // NOSONAR

        // Made it this far, we're connected now
        this.connected = true;
    }

    public async createNewKernelSession(options: {
        token: CancellationToken;
        ui: IDisplayOptions;
    }): Promise<ISessionWithSocket> {
        let newSession: ISessionWithSocket | undefined;
        try {
            // Don't immediately assume this kernel is valid. Try creating a session with it first.
            if (
                this.kernelConnectionMetadata &&
                this.kernelConnectionMetadata.kind === 'connectToLiveRemoteKernel' &&
                this.kernelConnectionMetadata.kernelModel.id &&
                this.kernelConnectionMetadata.kernelModel.model
            ) {
                // Remote case.
                newSession = this.sessionManager.connectTo({
                    ...this.kernelConnectionMetadata.kernelModel,
                    model: this.kernelConnectionMetadata.kernelModel.model
                }) as ISessionWithSocket;

                const request = newSession.kernel?.requestExecute(
                    {
                        code: 'import os; os.getcwd()',
                        silent: false,
                        stop_on_error: false,
                        allow_stdin: true,
                        store_history: false
                    },
                    true
                );
                request!.onIOPub = (msg) => {
                    console.log(msg);
                };

                await request!.done;

                newSession.kernelConnectionMetadata = this.kernelConnectionMetadata;
                newSession.kernelSocketInformation = {
                    socket: this.requestCreator.getWebsocket(this.kernelConnectionMetadata.id),
                    options: {
                        clientId: '',
                        id: this.kernelConnectionMetadata.id,
                        model: { ...this.kernelConnectionMetadata.kernelModel.model },
                        userName: ''
                    }
                };
                newSession.isRemoteSession = true;
                newSession.resource = this.resource;

                // newSession.kernel?.connectionStatus
                await waitForCondition(
                    async () => newSession?.kernel?.connectionStatus === 'connected',
                    this.idleTimeout,
                    100
                );
            } else {
                traceVerbose(`createNewKernelSession ${this.kernelConnectionMetadata?.id}`);
                newSession = await this.createSession(options);
                newSession.resource = this.resource;

                // Make sure it is idle before we return
                await this.waitForIdleOnSession(newSession, this.idleTimeout);
            }
        } catch (exc) {
            // Don't log errors if UI is disabled (e.g. auto starting a kernel)
            // Else we just pollute the logs with lots of noise.
            const loggerFn = options.ui.disableUI ? traceVerbose : traceError;
            // Don't swallow known exceptions.
            if (exc instanceof BaseError) {
                loggerFn('Failed to change kernel, re-throwing', exc);
                throw exc;
            } else {
                loggerFn('Failed to change kernel', exc);
                // Throw a new exception indicating we cannot change.
                throw new JupyterInvalidKernelError(this.kernelConnectionMetadata);
            }
        }

        // try print again

        return newSession;
    }

    protected async createRestartSession(
        disableUI: boolean,
        session: ISessionWithSocket,
        cancelToken: CancellationToken
    ): Promise<ISessionWithSocket> {
        // We need all of the above to create a restart session
        if (!session || !this.contentsManager || !this.sessionManager) {
            throw new SessionDisposedError();
        }
        await this.disposeBackingFile();
        let result: ISessionWithSocket | undefined;
        let tryCount = 0;
        const ui = new DisplayOptions(disableUI);
        try {
            traceVerbose(
                `JupyterSession.createNewKernelSession ${tryCount}, id is ${this.kernelConnectionMetadata?.id}`
            );
            result = await this.createSession({ token: cancelToken, ui });
            await this.waitForIdleOnSession(result, this.idleTimeout);
            return result;
        } catch (exc) {
            traceInfo(`Error waiting for restart session: ${exc}`);
            if (result) {
                this.shutdownSession(result, undefined, true).ignoreErrors();
            }
            result = undefined;
            throw exc;
        } finally {
            ui.dispose();
        }
    }

    protected startRestartSession(disableUI: boolean) {
        if (!this.session) {
            throw new Error('Session disposed or not initialized');
        }
        const token = new CancellationTokenSource();
        const promise = this.createRestartSession(disableUI, this.session, token.token);
        this.restartSessionPromise = { token, promise };
        promise.finally(() => {
            token.dispose();
            if (this.restartSessionPromise?.promise === promise) {
                this.restartSessionPromise = undefined;
            }
        });
        return promise;
    }

    async invokeWithFileSynced(handler: (file: IBackupFile) => Promise<void>): Promise<void> {
        if (!this.resource) {
            return;
        }

        const document = workspace.notebookDocuments.find(
            (document) => document.uri.toString() === this.resource!.toString()
        );

        if (!document) {
            return;
        }

        if (!this.backingFile) {
            this.backingFile = await this.backingFileCreator.createBackingFile(
                this.resource,
                this.workingDirectory,
                this.kernelConnectionMetadata,
                this.connInfo,
                this.contentsManager
            );
        }

        const content = await this.getContent(document);

        await this.contentsManager
            .save(this.backingFile!.filePath, {
                content: content,
                type: 'notebook'
            })
            .ignoreErrors();
        await handler({
            filePath: this.backingFile!.filePath,
            dispose: this.backingFile!.dispose.bind(this.backingFile!)
        });
        await this.disposeBackingFile();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async getContent(document: NotebookDocument): Promise<any> {
        const notebookContent = getNotebookMetadata(document);
        const preferredCellLanguage =
            notebookContent.metadata?.language_info?.name ?? document.cellAt(0).document.languageId;
        notebookContent.cells = document
            .getCells()
            .map((cell) => createJupyterCellFromNotebookCell(cell, preferredCellLanguage));
        // .map(pruneCell);

        // const indentAmount = document.metadata && 'indentAmount' in document.metadata && typeof document.metadata.indentAmount === 'string' ?
        // document.metadata.indentAmount :
        (' ');
        // ipynb always ends with a trailing new line (we add this so that SCMs do not show unnecesary changes, resulting from a missing trailing new line).
        return sortObjectPropertiesRecursively(notebookContent);
    }

    private async createSession(options: {
        token: CancellationToken;
        ui: IDisplayOptions;
    }): Promise<ISessionWithSocket> {
        // Create our backing file for the notebook
        this.backingFile = await this.backingFileCreator.createBackingFile(
            this.resource,
            this.workingDirectory,
            this.kernelConnectionMetadata,
            this.connInfo,
            this.contentsManager
        );

        // Make sure the kernel has ipykernel installed if on a local machine.
        if (
            this.kernelConnectionMetadata?.interpreter &&
            isLocalConnection(this.kernelConnectionMetadata) &&
            this.kernelService
        ) {
            // Make sure the kernel actually exists and is up to date.
            try {
                await this.kernelService.ensureKernelIsUsable(
                    this.resource,
                    this.kernelConnectionMetadata,
                    options.ui,
                    options.token,
                    this.sessionCreator === '3rdPartyExtension'
                );
            } catch (ex) {
                // If we failed to create the kernel, we need to clean up the file.
                if (this.connInfo && this.backingFile) {
                    this.contentsManager.delete(this.backingFile.filePath).ignoreErrors();
                }
                throw ex;
            }
        }

        // If kernelName is empty this can cause problems for servers that don't
        // understand that empty kernel name means the default kernel.
        // See https://github.com/microsoft/vscode-jupyter/issues/5290
        const kernelName =
            getNameOfKernelConnection(this.kernelConnectionMetadata) ?? this.specsManager?.specs?.default ?? '';

        // Create our session options using this temporary notebook and our connection info
        const sessionOptions: Session.ISessionOptions = {
            path: this.backingFile?.filePath || generateBackingIPyNbFileName(this.resource), // Name has to be unique
            kernel: {
                name: kernelName
            },
            name: uuid(), // This is crucial to distinguish this session from any other.
            type: 'notebook'
        };

        const requestCreator = this.requestCreator;

        return Cancellation.race(
            () =>
                this.sessionManager!.startNew(sessionOptions, {
                    kernelConnectionOptions: {
                        handleComms: true // This has to be true for ipywidgets to work
                    }
                })
                    .then(async (session) => {
                        if (session.kernel) {
                            this.logRemoteOutput(
                                DataScience.createdNewKernel().format(this.connInfo.baseUrl, session?.kernel?.id || '')
                            );
                            const sessionWithSocket = session as ISessionWithSocket;

                            // Add on the kernel metadata & sock information
                            sessionWithSocket.resource = this.resource;
                            sessionWithSocket.kernelConnectionMetadata = this.kernelConnectionMetadata;
                            sessionWithSocket.kernelSocketInformation = {
                                get socket() {
                                    // When we restart kernels, a new websocket is created and we need to get the new one.
                                    // & the id in the dictionary is the kernel.id.
                                    return requestCreator.getWebsocket(session.kernel!.id);
                                },
                                options: {
                                    clientId: session.kernel.clientId,
                                    id: session.kernel.id,
                                    model: { ...session.kernel.model },
                                    userName: session.kernel.username
                                }
                            };
                            if (!isLocalConnection(this.kernelConnectionMetadata)) {
                                sessionWithSocket.isRemoteSession = true;
                            }
                            return sessionWithSocket;
                        }
                        throw new JupyterSessionStartError(new Error(`No kernel created`));
                    })
                    .catch((ex) => Promise.reject(new JupyterSessionStartError(ex)))
                    .finally(async () => {
                        await this.disposeBackingFile();
                    }),
            options.token
        );
    }

    private async disposeBackingFile() {
        if (this.connInfo && this.backingFile) {
            await this.backingFile.dispose();
            await this.contentsManager.delete(this.backingFile.filePath).ignoreErrors();
        }
    }

    private logRemoteOutput(output: string) {
        if (!isLocalConnection(this.kernelConnectionMetadata)) {
            this.outputChannel.appendLine(output);
        }
    }
}

export function createJupyterCellFromNotebookCell(
    vscCell: NotebookCell,
    preferredLanguage: string | undefined
): nbformat.IRawCell | nbformat.IMarkdownCell | nbformat.ICodeCell {
    let cell: nbformat.IRawCell | nbformat.IMarkdownCell | nbformat.ICodeCell;
    if (vscCell.kind === NotebookCellKind.Markup) {
        cell = createMarkdownCellFromNotebookCell(vscCell);
    } else if (vscCell.document.languageId === 'raw') {
        cell = createRawCellFromNotebookCell(vscCell);
    } else {
        cell = createCodeCellFromNotebookCell(vscCell, preferredLanguage);
    }
    return cell;
}

function createMarkdownCellFromNotebookCell(cell: NotebookCell): nbformat.IMarkdownCell {
    const cellMetadata = getCellMetadata(cell);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const markdownCell: any = {
        cell_type: 'markdown',
        source: splitMultilineString(cell.document.getText().replace(/\r\n/g, '\n')),
        metadata: cellMetadata?.metadata || {} // This cannot be empty.
    };
    if (cellMetadata?.attachments) {
        markdownCell.attachments = cellMetadata.attachments;
    }
    if (cellMetadata?.id) {
        markdownCell.id = cellMetadata.id;
    }
    return markdownCell;
}

function createRawCellFromNotebookCell(cell: NotebookCell): nbformat.IRawCell {
    const cellMetadata = getCellMetadata(cell);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawCell: any = {
        cell_type: 'raw',
        source: splitMultilineString(cell.document.getText().replace(/\r\n/g, '\n')),
        metadata: cellMetadata?.metadata || {} // This cannot be empty.
    };
    if (cellMetadata?.attachments) {
        rawCell.attachments = cellMetadata.attachments;
    }
    if (cellMetadata?.id) {
        rawCell.id = cellMetadata.id;
    }
    return rawCell;
}

function createCodeCellFromNotebookCell(cell: NotebookCell, preferredLanguage: string | undefined): nbformat.ICodeCell {
    const cellMetadata = getCellMetadata(cell);
    let metadata = cellMetadata?.metadata || {}; // This cannot be empty.
    if (cell.document.languageId !== preferredLanguage) {
        metadata = {
            ...metadata,
            vscode: {
                languageId: cell.document.languageId
            }
        };
    } else {
        // cell current language is the same as the preferred cell language in the document, flush the vscode custom language id metadata
        metadata.vscode = undefined;
    }
    metadata.trusted = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const codeCell: any = {
        cell_type: 'code',
        execution_count: cell.executionSummary?.executionOrder ?? null,
        source: splitMultilineString(cell.document.getText().replace(/\r\n/g, '\n')),
        outputs: [], //.map(translateCellDisplayOutput),
        metadata: metadata
    };
    if (cellMetadata?.id) {
        codeCell.id = cellMetadata.id;
    }
    return codeCell;
}

export function getCellMetadata(cell: NotebookCell | NotebookCellData) {
    return cell.metadata?.custom;
}

function splitMultilineString(source: nbformat.MultilineString): string[] {
    if (Array.isArray(source)) {
        return source as string[];
    }
    const str = source.toString();
    if (str.length > 0) {
        // Each line should be a separate entry, but end with a \n if not last entry
        const arr = str.split('\n');
        return arr
            .map((s, i) => {
                if (i < arr.length - 1) {
                    return `${s}\n`;
                }
                return s;
            })
            .filter((s) => s.length > 0); // Skip last one if empty (it's the only one that could be length 0)
    }
    return [];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function sortObjectPropertiesRecursively(obj: any): any {
    if (Array.isArray(obj)) {
        return obj.map(sortObjectPropertiesRecursively);
    }
    if (obj !== undefined && obj !== null && typeof obj === 'object' && Object.keys(obj).length > 0) {
        return Object.keys(obj)
            .sort()
            .reduce<Record<string, any>>((sortedObj, prop) => {
                sortedObj[prop] = sortObjectPropertiesRecursively(obj[prop]);
                return sortedObj;
            }, {}) as any;
    }
    return obj;
}

export function getNotebookMetadata(document: NotebookDocument | NotebookData) {
    const notebookContent: Partial<nbformat.INotebookContent> = document.metadata?.custom || {};
    notebookContent.cells = notebookContent.cells || [];
    notebookContent.nbformat = notebookContent.nbformat || 4;
    notebookContent.nbformat_minor = notebookContent.nbformat_minor ?? 2;
    notebookContent.metadata = notebookContent.metadata || { orig_nbformat: 4 };
    return notebookContent;
}
