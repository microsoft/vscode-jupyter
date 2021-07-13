// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// import './styles.css';
import { ActivationFunction, OutputItem } from 'vscode-notebook-renderer';

export const activate: ActivationFunction = (_context) => {
    console.log('Jupyter Error Output Renderer Activated');
    return {
        renderOutputItem(outputItem: OutputItem, element: HTMLElement) {
            element.innerText = outputItem.text();
            console.error('Rendering error output on notebook open is not supported.');
        },
        disposeOutputItem() {
        }
    };
};
