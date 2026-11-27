// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { commands, NotebookCell, NotebookEditor, NotebookRendererMessaging, notebooks } from 'vscode';
import { dispose } from '../../../platform/common/utils/lifecycle';
import { logger } from '../../../platform/logging';
import { IDisposable } from '../../../platform/common/types';
import { createDeferred, Deferred, raceTimeoutError } from '../../../platform/common/utils/async';
import { generateUuid } from '../../../platform/common/uuid';
import { defaultNotebookTestTimeout } from '../notebook/helper';
import colors from 'colors';

type WidgetRequest = {
    command: 'queryInnerHTML' | 'clickElement' | 'setElementValue';
    cellIndex: number;
    selector?: string;
    value?: string;
};

type WidgetResponse = { requestId?: string; innerHTML?: string; error?: unknown };

export function initializeWidgetComms(disposables: IDisposable[], editor?: NotebookEditor): Utils {
    const messageChannel = notebooks.createRendererMessaging('jupyter-ipywidget-renderer');
    if (!messageChannel) {
        throw new Error('No Widget renderer comms channel');
    }
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    const utils = new Utils(messageChannel, editor);
    disposables.push(utils);
    return utils;
}

export class Utils {
    private readonly disposables: IDisposable[] = [];
    private readonly editor = createDeferred<NotebookEditor>();
    private readonly pendingRequests = new Map<string, Deferred<WidgetResponse>>();
    private disposed = false;
    private readyPromise?: Promise<NotebookEditor>;

    public get ready(): Promise<void> {
        return this.getEditor().then(() => undefined);
    }

    private getEditor(): Promise<NotebookEditor> {
        if (this.disposed) {
            return Promise.reject(new Error('Widget renderer comms were disposed'));
        }
        if (this.editor.resolved) {
            return this.editor.promise;
        }
        if (!this.readyPromise) {
            // Without an explicit editor, retain the original first-INIT behavior.
            this.readyPromise = this.targetEditor
                ? this.sendRequest(
                      this.targetEditor,
                      { command: 'queryInnerHTML', cellIndex: 0, selector: '.widget-output' },
                      true
                  ).then(() => this.targetEditor!)
                : raceTimeoutError(
                      defaultNotebookTestTimeout,
                      new Error('Timed out waiting for Widget renderer INIT'),
                      this.editor.promise
                  );
        }
        return this.readyPromise;
    }

    constructor(
        private readonly messageChannel: NotebookRendererMessaging,
        private readonly targetEditor?: NotebookEditor
    ) {
        logger.ci(`Adding comm message handler`);
        // The editor may be disposed before anyone asks for readiness.
        this.editor.promise.catch(() => undefined);
        this.disposables.push(
            this.messageChannel.onDidReceiveMessage(({ editor, message }) => {
                if (!message) {
                    return;
                }
                const expectedEditor = this.targetEditor ?? this.editor.value;
                if (expectedEditor && editor !== expectedEditor) {
                    return;
                }
                if (message.command === 'INIT') {
                    this.markReady(editor);
                    return;
                }
                if (message.command === 'log') {
                    const messageToLog = message.category === 'error' ? colors.red(message.message) : message.message;
                    const category = message.category ? ` (${message.category})` : '';
                    logger.info(`${colors.yellow('Widget renderer')}${category}: ${messageToLog}`);
                } else if (editor === expectedEditor && typeof message.requestId === 'string') {
                    this.pendingRequests.get(message.requestId)?.resolve(message);
                }
            })
        );
    }

    public dispose() {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        const error = new Error('Widget renderer comms were disposed');
        this.pendingRequests.forEach((request) => request.reject(error));
        this.pendingRequests.clear();
        if (!this.editor.completed) {
            this.editor.reject(error);
        }
        dispose(this.disposables);
    }

    public async queryHtml(cell: NotebookCell, selector?: string) {
        const response = await this.request(cell, { command: 'queryInnerHTML', selector });
        return response.innerHTML || '';
    }

    public async click(cell: NotebookCell, selector: string) {
        await this.request(cell, { command: 'clickElement', selector });
    }

    public async setValue(cell: NotebookCell, selector: string, value: string) {
        await this.request(cell, { command: 'setElementValue', selector, value });
    }

    private async request(cell: NotebookCell, request: Omit<WidgetRequest, 'cellIndex'>) {
        const editor = await this.getEditor();
        if (cell.notebook !== editor.notebook) {
            throw new Error(`Widget cell belongs to a different notebook than ${editor.notebook.uri.toString()}`);
        }
        return this.sendRequest(editor, { ...request, cellIndex: cell.index });
    }

    private async sendRequest(
        editor: NotebookEditor,
        request: WidgetRequest,
        waitForInit = false
    ): Promise<WidgetResponse> {
        if (this.disposed) {
            throw new Error('Widget renderer comms were disposed');
        }
        const message = { ...request, requestId: generateUuid() };
        const context =
            `${request.command}, cell ${request.cellIndex}, selector ${request.selector || '<root>'}, ` +
            `editor ${editor.notebook.uri.toString()}, request ${message.requestId}`;
        const timeout = waitForInit ? defaultNotebookTestTimeout : 5_000;
        const response = createDeferred<WidgetResponse>();
        this.pendingRequests.set(message.requestId, response);
        try {
            logger.info(`Sending message to Widget renderer ${JSON.stringify(message)} (${context})`);
            this.messageChannel.postMessage(message, editor).then(
                (delivered) => {
                    if (!delivered && !waitForInit) {
                        response.reject(new Error(`Widget renderer message was not delivered (${context})`));
                    }
                },
                (error) => response.reject(new Error(`Widget renderer post failed (${context}): ${String(error)}`))
            );
            const reply = await raceTimeoutError(
                timeout,
                new Error(`Timed out after ${timeout}ms waiting for Widget renderer (${context})`),
                waitForInit
                    ? Promise.race([response.promise, this.editor.promise.then((): WidgetResponse => ({}))])
                    : response.promise
            );
            // A missing element still proves that an already-initialized renderer handled the probe.
            const missingProbe = waitForInit && reply.error === `No element for cell index ${request.cellIndex}`;
            if (reply.error && !missingProbe) {
                throw new Error(`Widget renderer error (${context}): ${String(reply.error)}`);
            }
            if (waitForInit) {
                this.markReady(editor);
            }
            return reply;
        } finally {
            this.pendingRequests.delete(message.requestId);
        }
    }

    private markReady(editor: NotebookEditor) {
        if (this.editor.completed || this.disposed) {
            return;
        }
        this.editor.resolve(editor);
        try {
            this.messageChannel.postMessage({ command: 'hijackLogging' }, editor).then(
                (delivered) => {
                    if (!delivered) {
                        logger.warn(`Could not enable Widget renderer logging for ${editor.notebook.uri.toString()}`);
                    }
                },
                (error) => logger.warn(`Could not enable Widget renderer logging: ${String(error)}`)
            );
        } catch (error) {
            logger.warn(`Could not enable Widget renderer logging: ${String(error)}`);
        }
    }
}

export async function hideOutputPanel() {
    // Work around for the removal of the command `workbench.action.closePanel`.
    // await commands.executeCommand('workbench.action.terminal.killAll');
    await commands.executeCommand('workbench.action.problems.focus');
    await commands.executeCommand('workbench.action.togglePanel');
}
