// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { NotebookCell, NotebookEditor, NotebookRendererMessaging, notebooks } from 'vscode';
import { dispose } from '../../../platform/common/helpers';
import { traceInfo, traceInfoIfCI } from '../../../platform/logging';
import { IDisposable } from '../../../platform/common/types';
import { createDeferred } from '../../../platform/common/utils/async';
import { noop } from '../../core';
import colors from 'colors';

export function initializeWidgetComms(disposables: IDisposable[]): Utils {
    const messageChannel = notebooks.createRendererMessaging('jupyter-ipywidget-renderer');
    if (!messageChannel) {
        throw new Error('No Widget renderer comms channel');
    }
    const deferred = createDeferred<NotebookEditor>();
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    const utils = new Utils(messageChannel, deferred.promise);
    disposables.push(utils);
    traceInfoIfCI(`Adding comm message handler`);
    const disposable = messageChannel.onDidReceiveMessage(async ({ editor, message }) => {
        if (message && message.command === 'log') {
            const messageToLog = message.category === 'error' ? colors.red(message.message) : message.message;
            const category = message.category ? ` (${message.category})` : '';
            traceInfo(`${colors.yellow('Widget renderer')}${category}: ${messageToLog}`);
        }
        if (message && message.command === 'INIT') {
            deferred.resolve(editor);
            // Redirect all of console.log, console.warn & console.error messages from
            // renderer to the extension host.
            messageChannel.postMessage({ command: 'hijackLogging' }, editor).then(noop, noop);
        }
    });
    disposables.push(disposable);
    return utils;
}

export class Utils {
    private readonly disposables: IDisposable[] = [];
    public get ready(): Promise<void> {
        return this.editorPromise.then(() => undefined);
    }
    constructor(
        private readonly messageChannel: NotebookRendererMessaging,
        private readonly editorPromise: Promise<NotebookEditor>
    ) {}
    public dispose() {
        dispose(this.disposables);
    }
    public async queryHtml(cell: NotebookCell, selector?: string) {
        // Verify the slider widget is created.
        const request = {
            requestId: Date.now().toString(),
            cellIndex: cell.index,
            command: 'queryInnerHTML',
            selector
        };
        const editor = await this.editorPromise;
        traceInfo(`Sending message to Widget renderer ${JSON.stringify(request)}`);
        this.messageChannel.postMessage!(request, editor).then(noop, noop);
        return new Promise<string>((resolve, reject) => {
            const disposable = this.messageChannel.onDidReceiveMessage(({ message }) => {
                if (message && message.requestId === request.requestId) {
                    disposable.dispose();
                    if (message.error) {
                        return reject(message.error);
                    }
                    resolve(message.innerHTML || '');
                }
            });
            this.disposables.push(disposable);
        });
    }
    public async click(cell: NotebookCell, selector: string) {
        // Verify the slider widget is created.
        const request = {
            requestId: Date.now().toString(),
            cellIndex: cell.index,
            command: 'clickElement',
            selector
        };
        const editor = await this.editorPromise;
        traceInfo(`Sending message to Widget renderer ${JSON.stringify(request)}`);
        this.messageChannel.postMessage!(request, editor).then(noop, noop);
        return new Promise<void>((resolve, reject) => {
            const disposable = this.messageChannel.onDidReceiveMessage(({ message }) => {
                traceInfo(`Received message (click) from Widget renderer ${JSON.stringify(message)}`);
                if (message && message.requestId === request.requestId) {
                    disposable.dispose();
                    if (message.error) {
                        return reject(message.error);
                    }
                    resolve();
                }
            });
            this.disposables.push(disposable);
        });
    }
    public async setValue(cell: NotebookCell, selector: string, value: string) {
        // Verify the slider widget is created.
        const request = {
            requestId: Date.now().toString(),
            cellIndex: cell.index,
            command: 'setElementValue',
            selector,
            value
        };
        const editor = await this.editorPromise;
        traceInfo(`Sending message to Widget renderer ${JSON.stringify(request)}`);
        this.messageChannel.postMessage!(request, editor).then(noop, noop);
        return new Promise<void>((resolve, reject) => {
            const disposable = this.messageChannel.onDidReceiveMessage(({ message }) => {
                traceInfo(`Received message (setValue) from Widget renderer ${JSON.stringify(message)}`);
                if (message && message.requestId === request.requestId) {
                    disposable.dispose();
                    if (message.error) {
                        return reject(message.error);
                    }
                    resolve();
                }
            });
            this.disposables.push(disposable);
        });
    }
}
