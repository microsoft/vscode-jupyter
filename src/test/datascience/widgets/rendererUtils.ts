// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/*
    This script loads in the renderer and the notebook extension.
    This can be used to send receive messages and inspect the HTML (state of the renderer) for tests.
    This is only loaded in tests when & debugging (based on ENV variables).
*/
import type * as nbformat from '@jupyterlab/nbformat';
import { RendererContext, OutputItem } from 'vscode-notebook-renderer';

const outputsByCellIndex = new Map<number, HTMLElement>();
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
        const outputCellIndex = getOutputCellIndex(outputItem);
        if (typeof outputCellIndex === 'number') {
            outputsByCellIndex.set(outputCellIndex, element);
        }
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
handlers.set('clickElement', clickHandler);
handlers.set('setElementValue', setElementValueHandler);
handlers.set('hijackLogging', hijackLogging);

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
            rendererContext.postMessage!({
                command: 'log',
                message: `Error: Message not handled in Widget renderer ${JSON.stringify(message)}`
            });
            console.error('No handler for command', message.command);
        }
    });
    rendererContext.postMessage({ command: 'INIT' });
}

function queryInnerHTMLHandler({
    requestId,
    cellIndex,
    selector
}: {
    requestId: string;
    cellIndex: number;
    selector?: string;
}) {
    try {
        const nodes = document.querySelectorAll(`.vsc-test-cell-index-${cellIndex} ${selector || ''}`.trim());
        if (!nodes.length) {
            return rendererContext.postMessage!({
                requestId,
                error: `No element for cell index ${cellIndex}`
            });
        }
        let innerHTML = '';
        nodes.forEach((node) => (innerHTML += node.innerHTML));
        rendererContext.postMessage!({ requestId, innerHTML });
    } catch (ex) {
        rendererContext.postMessage!({ requestId, error: ex.message });
    }
}

function clickHandler({ requestId, cellIndex, selector }: { requestId: string; cellIndex: number; selector: string }) {
    try {
        const nodes = document.querySelectorAll(`.vsc-test-cell-index-${cellIndex} ${selector}`);
        if (!nodes.length) {
            return rendererContext.postMessage!({
                requestId,
                error: `No element for cell index ${cellIndex}`
            });
        }
        (nodes[0] as HTMLButtonElement).click();
        rendererContext.postMessage!({ requestId });
    } catch (ex) {
        rendererContext.postMessage!({ requestId, error: ex.message });
    }
}

function setElementValueHandler({
    requestId,
    cellIndex,
    selector,
    value
}: {
    requestId: string;
    cellIndex: number;
    selector: string;
    value: string;
}) {
    try {
        const nodes = document.querySelectorAll(`.vsc-test-cell-index-${cellIndex} ${selector}`);
        if (!nodes.length) {
            return rendererContext.postMessage!({
                requestId,
                error: `No element for cell index ${cellIndex}`
            });
        }
        const ele = nodes[0] as HTMLInputElement;
        if (!ele) {
            throw new Error(`Element not found ${selector}`);
        }
        ele.value = value;
        ele.dispatchEvent(new Event('change', { bubbles: true }));
        rendererContext.postMessage!({ requestId });
    } catch (ex) {
        rendererContext.postMessage!({ requestId, error: ex.message });
    }
}

function convertVSCodeOutputToExecuteResultOrDisplayData(
    outputItem: OutputItem
): nbformat.IExecuteResult | nbformat.IDisplayData {
    return {
        data: {
            [outputItem.mime]: outputItem.mime.toLowerCase().includes('json') ? outputItem.json() : outputItem.text()
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        metadata: (outputItem.metadata as any) || {},
        execution_count: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        output_type: (outputItem.metadata as any)?.outputType || 'execute_result'
    };
}

function getOutputCellIndex(outputItem: OutputItem): number | undefined {
    const output = convertVSCodeOutputToExecuteResultOrDisplayData(outputItem);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = output.data['application/vnd.jupyter.widget-view+json'] as any;
    if (model && '_vsc_test_cellIndex' in model) {
        return parseInt(model._vsc_test_cellIndex);
    }
}

let consoleLoggersHijacked = false;
/**
 * Highjack the console log messages & send them to the extension host.
 * On CI we cannot see the console log messages of the webview, so we need to hijack them.
 * Sometimes when widgets fail this is very useful in diagnosing what went wrong on the webview side of things.
 */
function hijackLogging() {
    if (consoleLoggersHijacked) {
        return;
    }
    consoleLoggersHijacked = true;
    type ConsoleChannel = 'log' | 'warn' | 'error' | 'debug' | 'trace';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const logMessage = (channel: ConsoleChannel, args: any[]) => {
        let message = `WebView ${channel} Console:`;
        (args || []).forEach((arg) => {
            try {
                // This could fail if we have cyclic objects.
                message += ` ${JSON.stringify(arg)},`;
            } catch {
                try {
                    message += ` ${(arg || '').toString()},`;
                } catch {
                    message += ` <Failed to serialize an argument>,`;
                }
            }
        });
        rendererContext.postMessage!({
            command: 'log',
            message: `Handled message in Widget renderer ${message}`,
            category: channel
        });
    };
    (['log', 'error', 'warn', 'debug', 'trace'] as ConsoleChannel[]).forEach((channel) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (console as any)[channel] = (...args: any[]) => {
            logMessage(channel, args);
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis.console as any)[channel] = (...args: any[]) => {
            logMessage(channel, args);
        };
    });
}
