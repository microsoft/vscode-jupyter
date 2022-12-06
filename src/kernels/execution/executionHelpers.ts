// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import type * as nbformat from '@jupyterlab/nbformat';

// After executing %tensorboard --logdir <log directory> to launch
// TensorBoard inline, TensorBoard sends back an IFrame to display as output.
// The TensorBoard app hardcodes the source URL of the IFrame to `window.location`.
// In the VSCode context this results in the URL taking on the internal
// vscode-webview:// scheme which doesn't work. Hence rewrite it to use
// http://localhost:<port number>.
export function handleTensorBoardDisplayDataOutput(data: nbformat.IMimeBundle) {
    if (data.hasOwnProperty('text/html')) {
        const text = data['text/html'];
        if (typeof text === 'string' && text.includes('<iframe id="tensorboard-frame-')) {
            data['text/html'] = text.replace(/new URL\((.*), window.location\)/, 'new URL("http://localhost")');
        }
    }
    return data;
}
