// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import './styles.css';
import { ActivationFunction, CellInfo } from 'vscode-notebook-renderer';

export const activate: ActivationFunction = (_context) => {
    console.log('Jupyter IPyWidget Renderer Activated');
    return {
        renderCell(outputId, info: CellInfo) {
            if (info.mime.toLowerCase() === 'application/javascript') {
                console.error('Rendering JavaScript');
                function render(element: HTMLElement, code: string) {
                    if (false) {
                        // We need a variable named `element` in current context.
                        console.log(element);
                    }
                    eval(code);
                }
                return render(info.element, info.text());
            }
            console.log('Jupyter IPyWidget Renderer started');
            const renderOutputFunc =
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (window as any).ipywidgetsKernel?.renderOutput || (global as any).ipywidgetsKernel?.renderOutput;
            if (renderOutputFunc) {
                info.element.className = (info.element.className || '') + ' cell-output-ipywidget-background';
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (window as any).element = $(info.element);
                return renderOutputFunc(outputId, info);
            }
            console.error('Rendering widgets on notebook open is not supported.');
        },
        destroyCell(outputId) {
            const disposeOutputFunc =
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (window as any).ipywidgetsKernel?.disposeOutput || (global as any).ipywidgetsKernel?.disposeOutput;
            if (disposeOutputFunc) {
                return disposeOutputFunc(outputId);
            }
        }
    };
};
