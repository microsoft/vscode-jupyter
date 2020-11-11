// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { NotebookRendererApi } from 'vscode-notebook-renderer';
const JupyterIPyWidgetNotebookRenderer = 'jupyter-ipywidget-renderer';

// tslint:disable: no-any
function initialize(api: NotebookRendererApi<any>) {
    // tslint:disable-next-line: no-any
    if (!(window as any).ipywidgetsKernel) {
        // tslint:disable-next-line: no-console
        console.error('Rendering IPyWidgets when loading a notebook is not supoorted.');
        return;
    }

    // tslint:disable-next-line: no-console
    console.log('Connecting renderer API');
    api.onDidCreateOutput((window as any).ipywidgetsKernel.renderOutput);
    api.onWillDestroyOutput((window as any).ipywidgetsKernel.disposeOutput);
}

initialize(acquireNotebookRendererApi(JupyterIPyWidgetNotebookRenderer));
