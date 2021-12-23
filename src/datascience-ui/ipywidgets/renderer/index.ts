// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import './styles.css';
import { ActivationFunction, OutputItem, RendererContext } from 'vscode-notebook-renderer';

export const activate: ActivationFunction = (context) => {
    if (context.postMessage) {
        context.postMessage({
            command: 'log',
            message: 'Jupyter IPyWidget Renderer Activated'
        });
    }
    console.log('Jupyter IPyWidget Renderer Activated');
    hookupTestScripts(context);
    const logger = (message: string) => {
        if (context.postMessage) {
            context.postMessage({
                command: 'log',
                message
            });
        }
    };
    return {
        renderOutputItem(outputItem: OutputItem, element: HTMLElement) {
            if (context.postMessage) {
                context.postMessage({
                    command: 'log',
                    message: `Rendering ${outputItem.id}`
                });
            }
            try {
                const renderOutputFunc =
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (window as any).ipywidgetsKernel?.renderOutput || (global as any).ipywidgetsKernel?.renderOutput;
                if (renderOutputFunc) {
                    element.className = (element.className || '') + ' cell-output-ipywidget-background';
                    if (context.postMessage) {
                        context.postMessage({
                            command: 'log',
                            message: `Rendering ${outputItem.id} for ${element.className} and widget renderer found *************`
                        });
                    }
                    return renderOutputFunc(outputItem, element, logger);
                }
                console.error('Rendering widgets on notebook open is not supported.');
            } finally {
                sendRenderOutputItem(context, outputItem, element);
            }
        },
        disposeOutputItem(id?: string) {
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
        console.log(`No Widgetentry point`);
        return;
    }
    if (context.postMessage) {
        context.postMessage({
            command: 'log',
            message: 'Hook registered'
        });
    }
    console.log(`Widgetentry point found`);
    anyWindow.widgetEntryPoint.initialize(context);
}
function sendRenderOutputItem(context: RendererContext<unknown>, outputItem: OutputItem, element: HTMLElement) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyWindow = window as any;
    if (!anyWindow.widgetEntryPoint || typeof anyWindow.widgetEntryPoint.renderOutputItem !== 'function') {
        console.log(`No Widgetentry point (2)`);
        return;
    }
    if (context.postMessage) {
        context.postMessage({
            command: 'log',
            message: 'rendering output'
        });
    }
    console.log(`Widgetentry point found (2)`);
    anyWindow.widgetEntryPoint.renderOutputItem(outputItem, element);
}
