// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

export declare function acquireVsCodeApi(): IVsCodeApi;

// /* eslint-disable @typescript-eslint/no-explicit-any, no-console */
// function renderOutput(e: NotebookOutputEventParams) {
//     const renderOutputFunc =
//         (window as any).ipywidgetsKernel?.renderOutput || (global as any).ipywidgetsKernel?.renderOutput;
//     if (renderOutputFunc) {
//         return renderOutputFunc(e);
//     }
//     console.error('Rendering widgets on notebook open is not supported.');
// }

// function disposeOutput(e: { outputId: string } | undefined) {
//     const disposeOutputFunc =
//         (window as any).ipywidgetsKernel?.disposeOutput || (global as any).ipywidgetsKernel?.disposeOutput;
//     if (disposeOutputFunc) {
//         return disposeOutputFunc(e);
//     }
// }

/* eslint-disable @typescript-eslint/no-explicit-any */
function initialize() {
    // const vscApi = acquireVsCodeApi();
    // vscApi.postMessage('Initialized');
    console.log('Initialized sidecar');
    console.log('(window as any)._jupyter_postOffice');
    console.log((window as any)._jupyter_postOffice);
    console.log('(window as any).ipywidgetsKernel');
    console.log((window as any).ipywidgetsKernel);
    console.log('(window as any).getKernel');
    console.log((window as any).getKernel);
    if (window.onmessage) {
        (window.onmessage as any)(messageHandler);
    }
}

function messageHandler(msg: any) {
    console.log(`In Side car`);
    console.log(msg);
}

initialize();
