// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { NotebookOutputEventParams, NotebookRendererApi } from 'vscode-notebook-renderer';
const JupyterIPyWidgetNotebookRenderer = 'jupyter-ipywidget-renderer';

// tslint:disable: no-any no-console
function renderOutput(e: NotebookOutputEventParams) {
    if ((window as any).ipywidgetsKernel?.renderOutput) {
        return (window as any).ipywidgetsKernel?.renderOutput(e);
    }
    console.error('Rendering widgets on notebook open is not supported.');
}

function disposeOutput(e: { outputId: string } | undefined) {
    if ((window as any).ipywidgetsKernel?.disposeOutput) {
        return (window as any).ipywidgetsKernel?.disposeOutput(e);
    }
}

// tslint:disable: no-any
function initialize(api: NotebookRendererApi<any>) {
    api.onDidCreateOutput(renderOutput);
    api.onWillDestroyOutput(disposeOutput);
}

initialize(acquireNotebookRendererApi(JupyterIPyWidgetNotebookRenderer));
