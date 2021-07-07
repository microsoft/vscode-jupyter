// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import './styles.css';
import { ActivationFunction, OutputItem } from 'vscode-notebook-renderer';

export const activate: ActivationFunction = (_context) => {
    console.log('Jupyter IPyWidget Renderer Activated');
    return {
        renderOutputItem(outputItem: OutputItem, element: HTMLElement) {
            const renderOutputFunc =
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (window as any).ipywidgetsKernel?.renderOutput || (global as any).ipywidgetsKernel?.renderOutput;
            if (renderOutputFunc) {
                element.className = (element.className || '') + ' cell-output-ipywidget-background';
                return renderOutputFunc(outputItem, element);
            }
            console.error('Rendering widgets on notebook open is not supported.');
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
