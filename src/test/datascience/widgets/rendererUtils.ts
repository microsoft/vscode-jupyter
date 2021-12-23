// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/*
    This script loads in the renderer and the notebook extension.
    This can be used to send receive messages and inspect the HTML (state of the renderer) for tests.
    This is only loaded in tests when & debugging (based on ENV variables).
*/

import { RendererContext, OutputItem } from 'vscode-notebook-renderer';

let rendererContext: RendererContext<unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).widgetEntryPoint = {
    initialize: (context: RendererContext<unknown>) => {
        rendererContext = context;
        initializeComms();
    },
    renderOutputItem: (outputItem: OutputItem, _element: HTMLElement) => {
        if (rendererContext && rendererContext.postMessage) {
            const message = { command: 'TEST_RENDER_OUTPUT', data: outputItem.id };
            rendererContext.postMessage(message);
        }
    }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handlers = new Map<string, (data: any) => void>();
handlers.set('queryInnerHTML', queryInnerHTMLHandler);

function initializeComms() {
    if (!rendererContext.onDidReceiveMessage || !rendererContext.postMessage) {
        return;
    }
    rendererContext.onDidReceiveMessage((message) => {
        if (!message || !message.command) {
            return;
        }
        if (handlers.has(message.command)) {
            handlers.get(message.command)!(message);
        } else {
            console.error('No handler for command', message.command);
        }
    });
    rendererContext.postMessage({ command: 'INIT' });
}

function queryInnerHTMLHandler(message: { id: string; selector: string }) {
    try {
        const innerHTML = document.querySelector(message.selector)?.innerHTML;
        rendererContext.postMessage!({ id: message.id, innerHTML });
    } catch (ex) {
        rendererContext.postMessage!({ id: message.id, error: ex.message });
    }
}
