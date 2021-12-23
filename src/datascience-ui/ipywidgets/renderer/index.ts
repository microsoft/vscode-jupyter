// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import './styles.css';
import { ActivationFunction, OutputItem, RendererContext } from 'vscode-notebook-renderer';

export const activate: ActivationFunction = (context) => {
    console.log('Jupyter IPyWidget Renderer Activated');
    hookupTestScripts(context);
    return {
        renderOutputItem(outputItem: OutputItem, element: HTMLElement) {
            try {
                const renderOutputFunc =
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (window as any).ipywidgetsKernel?.renderOutput || (global as any).ipywidgetsKernel?.renderOutput;
                if (renderOutputFunc) {
                    element.className = (element.className || '') + ' cell-output-ipywidget-background';
                    return renderOutputFunc(outputItem, element);
                }
                console.error('Rendering widgets on notebook open is not supported.');
            } finally {
                sendRenderOutputItem(outputItem, element);
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
        console.log(`No Widgetentry point`);
        return;
    }
    console.log(`Widgetentry point found`);
    anyWindow.widgetEntryPoint.initialize(context);
}
function sendRenderOutputItem(outputItem: OutputItem, element: HTMLElement) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyWindow = window as any;
    if (!anyWindow.widgetEntryPoint || typeof anyWindow.widgetEntryPoint.renderOutputItem !== 'function') {
        console.log(`No Widgetentry point (2)`);
        return;
    }
    console.log(`Widgetentry point found (2)`);
    anyWindow.widgetEntryPoint.renderOutputItem(outputItem, element);
}
