// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { NotebookCell, NotebookEditor, NotebookRendererMessaging, notebooks } from 'vscode';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { traceInfo } from '../../../platform/logging';
import { IDisposable, IDisposableRegistry } from '../../../platform/common/types';
import { createDeferred } from '../../../platform/common/utils/async';
import { IServiceContainer } from '../../../platform/ioc/types';
import { noop } from '../../core';

export function initializeWidgetComms(serviceContainer: IServiceContainer): Utils {
    const disposables = serviceContainer.get<IDisposableRegistry>(IDisposableRegistry);
    const messageChannel = notebooks.createRendererMessaging('jupyter-ipywidget-renderer');
    if (!messageChannel) {
        throw new Error('No Widget renderer comms channel');
    }
    const deferred = createDeferred<NotebookEditor>();
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    const utils = new Utils(messageChannel, deferred.promise);
    disposables.push(utils);
    const disposable = messageChannel.onDidReceiveMessage(async ({ editor, message }) => {
        traceInfo(`Received message from Widget renderer ${JSON.stringify(message)}`);
        if (message && message.command === 'INIT') {
            // disposable.dispose();
            deferred.resolve(editor);
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
        disposeAllDisposables(this.disposables);
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
                traceInfo(`Received message (query) from Widget renderer ${JSON.stringify(message)}`);
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
