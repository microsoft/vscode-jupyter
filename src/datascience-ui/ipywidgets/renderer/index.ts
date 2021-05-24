// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import './styles.css';
import { ActivationFunction, CellInfo } from 'vscode-notebook-renderer';

export const activate: ActivationFunction = (_context) => {
    console.log('Jupyter IPyWidget Renderer activated');
    return {
        renderCell(outputId, info: CellInfo) {
            const renderOutputFunc =
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (window as any).ipywidgetsKernel?.renderOutput || (global as any).ipywidgetsKernel?.renderOutput;
            if (renderOutputFunc) {
                info.element.className = (info.element.className || '') + ' cell-output-ipywidget-background';
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

//import { NotebookOutputEventParams, NotebookRendererApi } from 'vscode-notebook-renderer';

/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
// function renderOutput(_e: CellInfo) {
// const renderOutputFunc =
// (window as any).ipywidgetsKernel?.renderOutput || (global as any).ipywidgetsKernel?.renderOutput;
// if (renderOutputFunc) {
// e.element.className = (e.element.className || '') + ' cell-output-ipywidget-background';
// return renderOutputFunc(e);
// }
// console.error('Rendering widgets on notebook open is not supported.');
// }

// function disposeOutput(e: { outputId: string } | undefined) {
// const disposeOutputFunc =
// (window as any).ipywidgetsKernel?.disposeOutput || (global as any).ipywidgetsKernel?.disposeOutput;
// if (disposeOutputFunc) {
// return disposeOutputFunc(e);
// }
// }

/* eslint-disable @typescript-eslint/no-explicit-any */
// function initialize(api: NotebookRendererApi<any>) {
// api.onDidCreateOutput(renderOutput);
// api.onWillDestroyOutput(disposeOutput);
// }

// initialize(acquireNotebookRendererApi());
