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
    console.log('acquireVsCodeApi');
    console.log(acquireVsCodeApi);
    // vscApi.postMessage('Initialized');
    console.log('Initialized sidecar');
    console.log('(window as any)._jupyter_postOffice');
    console.log((window as any)._jupyter_postOffice);
    const postOffice = (window as any)._jupyter_postOffice;
    console.log('(window as any).ipywidgetsKernel');
    console.log((window as any).ipywidgetsKernel);
    console.log('(window as any).getKernel');
    console.log((window as any).ipywidgetsKernel.getKernel);
    if (window.onmessage) {
        (window.onmessage as any)(messageHandler);
    }
    if (postOffice) {
        console.error('Post Office exists & sending message');
        postOffice.sendMessage('CUSTOM_VIEW', { h: 'helloFromUI' });
        postOffice.addHandler({
            handleMessage: (type: string, payload?: any) => {
                console.log(`type = ${type}, payload = ${payload}`);
                if (type === 'HelloWordFromExt'){
                    console.error('Received message from Exteension');
                }
                if (type === 'RENDER_WIDGET'){
                    console.error('Received message to reender Widget', payload);
                    const renderOutputFunc =
                    (window as any).ipywidgetsKernel?.renderOutput || (global as any).ipywidgetsKernel?.renderOutput;
                    if (renderOutputFunc) {
                        console.error('Rendering');
                        renderOutputFunc({
                            element: document.getElementById('variableWidgetContainer'),
                            outputId: 'variableWidgetContainer',
                            value: payload.data['application/vnd.jupyter.widget-view+json'],
                            mime: 'application/vnd.jupyter.widget-view+json',
                            metadata: payload.metadata
                        });
                    }

                }
                return true;
            }
        });
    } else {
        console.error('Post Office does not exist');
    }
}

function messageHandler(msg: any) {
    console.log(`In Side car`);
    console.log(msg);
}

initialize();
