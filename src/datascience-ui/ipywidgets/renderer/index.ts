// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { NotebookOutputEventParams, NotebookRendererApi } from 'vscode-notebook-renderer';
const JupyterIPyWidgetNotebookRenderer = 'jupyter-ipywidget-renderer';

/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
function renderOutput(e: NotebookOutputEventParams) {
    const renderOutputFunc =
        (window as any).ipywidgetsKernel?.renderOutput || (global as any).ipywidgetsKernel?.renderOutput;
    if (renderOutputFunc) {
        return renderOutputFunc(e);
    }
    console.error('Rendering widgets on notebook open is not supported.');
}

function disposeOutput(e: { outputId: string } | undefined) {
    const disposeOutputFunc =
        (window as any).ipywidgetsKernel?.disposeOutput || (global as any).ipywidgetsKernel?.disposeOutput;
    if (disposeOutputFunc) {
        return disposeOutputFunc(e);
    }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function initialize(api: NotebookRendererApi<any>) {
    api.onDidCreateOutput(renderOutput);
    api.onWillDestroyOutput(disposeOutput);
}

initialize(acquireNotebookRendererApi(JupyterIPyWidgetNotebookRenderer));
