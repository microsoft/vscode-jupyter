// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { NotebookRendererApi } from 'vscode-notebook-renderer';
const JupyterIPyWidgetNotebookRenderer = 'jupyter-ipywidget-renderer';

// tslint:disable-next-line: no-console
console.log('(window as any).ipywidgetsKernel');
// tslint:disable-next-line: no-console
console.log((window as any).ipywidgetsKernel);

function initialize(api: NotebookRendererApi<any>) {
    if (!(window as any).ipywidgetsKernel) {
        // tslint:disable-next-line: no-console
        console.error('Rendering IPyWidgets when loading a notebook is not supoorted.');
        return;
    }
    // tslint:disable-next-line: no-any
    api.onDidCreateOutput((window as any).ipywidgetsKernel.renderOutput);
    // api.onWillDestroyOutput((e) => {
    //     if (e?.outputId && outputDisposables.has(e.outputId)) {
    //         outputDisposables.get(e.outputId)?.dispose(); // NOSONAR
    //         outputDisposables.delete(e.outputId);
    //     }
    // });
    api.postMessage('Loaded');
}

initialize(acquireNotebookRendererApi(JupyterIPyWidgetNotebookRenderer));
