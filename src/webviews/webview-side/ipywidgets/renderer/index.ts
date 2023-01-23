// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import './styles.css';
import { ActivationFunction, OutputItem, RendererContext } from 'vscode-notebook-renderer';
import { IPyWidgetMessages } from '../../../../messageTypes';

const disposedOutputItems = new Set<string>();
const itemsNotRendered = new Map<string, { outputItem: OutputItem; element: HTMLElement }>();
const outputItemsOwnedByThisWebView = new Set<string>();
let canRenderWidgets = true;
export const activate: ActivationFunction = (context) => {
    const logger = (message: string, category?: 'info' | 'error') => {
        if (context.postMessage) {
            context.postMessage({
                command: 'log',
                message,
                category
            });
        }
    };
    logger('Jupyter IPyWidget Renderer Activated');
    hookupTestScripts(context);
    if (context.onDidReceiveMessage) {
        context.onDidReceiveMessage((message) => {
            if (message && 'type' in message && message.type === IPyWidgetMessages.IPyWidgets_ReRenderWidgets) {
                logger(`Received message to re-render widgets, have ${itemsNotRendered.size} items to render`);
                canRenderWidgets = true;
                itemsNotRendered.forEach((value, key) => {
                    itemsNotRendered.delete(key);
                    const { outputItem, element } = value;
                    renderWidgetOutput(outputItem, element, logger);
                });
            } else if (
                message &&
                'type' in message &&
                message.type === IPyWidgetMessages.IPyWidgets_DoNotRenderWidgets
            ) {
                logger('Received message to not render widgets');
                canRenderWidgets = false;
            }
        });
    }
    return {
        renderOutputItem(outputItem: OutputItem, element: HTMLElement) {
            outputItemsOwnedByThisWebView.add(outputItem.id);
            logger(
                `Got item for Rendering ${outputItem.id}, ${Array.from(outputItemsOwnedByThisWebView.values()).join(
                    ', '
                )}`
            );
            try {
                renderWidgetOutput(outputItem, element, logger);
            } finally {
                sendRenderOutputItem(context, outputItem, element);
            }
        },
        disposeOutputItem(id?: string) {
            logger(
                `Disposing rendered output for ${id}, ${Array.from(outputItemsOwnedByThisWebView.values()).join(', ')}`
            );
            outputItemsOwnedByThisWebView.delete(id || '');
            if (id) {
                disposedOutputItems.add(id);
            }
            const disposeOutputFunc =
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (window as any).ipywidgetsKernel?.disposeOutput || (global as any).ipywidgetsKernel?.disposeOutput;
            if (disposeOutputFunc) {
                return disposeOutputFunc(id);
            }
        }
    };
};
function renderWidgetOutput(
    outputItem: OutputItem,
    element: HTMLElement,
    logger: (message: string, category?: 'info' | 'error') => void
) {
    if (disposedOutputItems.has(outputItem.id)) {
        return;
    }
    logger(`Check Rendering ${outputItem.id}, ${Array.from(outputItemsOwnedByThisWebView.values()).join(', ')}`);
    const renderOutputFunc =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).ipywidgetsKernel?.renderOutput || (global as any).ipywidgetsKernel?.renderOutput;
    if (renderOutputFunc || !canRenderWidgets) {
        element.className = (element.className || '') + ' cell-output-ipywidget-background';
        return renderOutputFunc(outputItem, element, logger);
    } else {
        if (!canRenderWidgets) {
            logger(`Cannot render widgets just yet, ${outputItem.id}`);
        }
        // There are two possibilities,
        // 1. We've opened an existing notebook with widget output.
        // 2. We ran a cell pointing to a Remote KernelSpec, and the controller then changed
        //   to point to a live kernel session, at which point the widget unloads & loads again.
        //   But thats all async, and when it re-loads the widget manager may not yet have been initialized.
        // Unfortunately, VS Code loads the webview & re-renders the outputs before we can start the widget manager.
        // Hence we don't know which case we're in.
        // Thus keep track of the output, and once the widget manager has
        // been initialized we might get a message back asking for the outputs to be rendered.
        itemsNotRendered.set(outputItem.id, { outputItem, element });
        console.error(`Rendering widgets on notebook open is not supported, ${outputItem.id}.`);
        logger(`Rendering widgets on notebook open is not supported, ${outputItem.id}.`, 'error');
    }
}
function hookupTestScripts(context: RendererContext<unknown>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyWindow = window as any;
    if (!anyWindow.widgetEntryPoint || typeof anyWindow.widgetEntryPoint.initialize !== 'function') {
        if (context.postMessage) {
            context.postMessage({
                command: 'log',
                message: 'Hook not registered'
            });
        }
        return;
    }
    anyWindow.widgetEntryPoint.initialize(context);
}
function sendRenderOutputItem(context: RendererContext<unknown>, outputItem: OutputItem, element: HTMLElement) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyWindow = window as any;
    if (!anyWindow.widgetEntryPoint || typeof anyWindow.widgetEntryPoint.renderOutputItem !== 'function') {
        return;
    }
    if (context.postMessage) {
        context.postMessage({
            command: 'log',
            message: 'rendering output'
        });
    }
    anyWindow.widgetEntryPoint.renderOutputItem(outputItem, element);
}
