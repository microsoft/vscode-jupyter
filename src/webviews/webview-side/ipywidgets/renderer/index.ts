// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import './styles.css';
import { ActivationFunction, OutputItem, RendererContext } from 'vscode-notebook-renderer';
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
    return {
        renderOutputItem(outputItem: OutputItem, element: HTMLElement) {
            logger(`Got item for Rendering ${outputItem.id}}`);
            try {
                const renderOutputFunc =
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (window as any).ipywidgetsKernel?.renderOutput || (global as any).ipywidgetsKernel?.renderOutput;
                if (renderOutputFunc) {
                    element.className = (element.className || '') + ' cell-output-ipywidget-background';
                    logger(
                        `Rendering ${outputItem.id} for ${element.className} and widget renderer found *************`
                    );
                    return renderOutputFunc(outputItem, element, logger);
                }
                console.error('Rendering widgets on notebook open is not supported.');
            } finally {
                sendRenderOutputItem(context, outputItem, element);
            }
        },
        disposeOutputItem(id?: string) {
            logger(`Disposing rendered output for ${id}`);
            const disposeOutputFunc =
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (window as any).ipywidgetsKernel?.disposeOutput || (global as any).ipywidgetsKernel?.disposeOutput;
            if (disposeOutputFunc) {
                return disposeOutputFunc(id);
            }
        }
    };
};

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
