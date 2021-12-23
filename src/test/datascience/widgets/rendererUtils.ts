// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/*
    This script loads in the renderer and the notebook extension.
    This can be used to send receive messages and inspect the HTML (state of the renderer) for tests.
    This is only loaded in tests when & debugging (based on ENV variables).
*/

import { RendererContext, OutputItem } from 'vscode-notebook-renderer';

const outputs = new Map<string, HTMLElement>();
let rendererContext: RendererContext<unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).widgetEntryPoint = {
    initialize: (context: RendererContext<unknown>) => {
        console.log(`Initialize in Widget renderer`);
        rendererContext = context;
        context.postMessage!({ command: 'log', message: 'Initializing' });
        initializeComms();
    },
    renderOutputItem: (outputItem: OutputItem, element: HTMLElement) => {
        outputs.set(outputItem.id, element);
        if (rendererContext && rendererContext.postMessage) {
            rendererContext.postMessage({ command: 'log', message: `Rendering (2) ${outputItem.id}` });
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
        console.log(`Received message in Widget renderer ${JSON.stringify(message)}`);
        rendererContext.postMessage!({
            command: 'log',
            message: `Received message in Widget renderer ${JSON.stringify(message)}`
        });

        if (!message || !message.command) {
            return;
        }
        if (handlers.has(message.command)) {
            rendererContext.postMessage!({
                command: 'log',
                message: `Handled message in Widget renderer ${JSON.stringify(message)}`
            });
            handlers.get(message.command)!(message);
        } else {
            console.error('No handler for command', message.command);
        }
    });
    rendererContext.postMessage({ command: 'INIT' });
}

function queryInnerHTMLHandler({ requestId, id, selector }: { requestId: string; id: string; selector: string }) {
    try {
        const element = outputs.get(id);
        if (!element) {
            return rendererContext.postMessage!({
                requestId,
                error: `No element for id ${id}`
            });
        }
        const innerHTML = element.querySelector(selector)?.innerHTML;
        rendererContext.postMessage!({ requestId, innerHTML });
    } catch (ex) {
        rendererContext.postMessage!({ requestId, error: ex.message });
    }
}
