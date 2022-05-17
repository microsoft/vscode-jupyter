// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { ActivationFunction, OutputItem } from 'vscode-notebook-renderer';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { DataWranglerHtmlRenderer } from './dataWranglerHtmlRenderer';

import './styles.css';

let Localizations = {
    'DataScience.launchDataWrangler': 'Launch Data Wrangler',
    'DataScience.dataWranglerVariableWasLost': "Could not find variable '{0}'. Please re-execute the cell to retry."
};

export const activate: ActivationFunction = async (context) => {
    const defaultRenderer = await context.getRenderer('vscode.builtin-notebook-renderers');
    let isReady = false;

    if (context.postMessage && context.onDidReceiveMessage) {
        const requestLocalization = () => {
            context.postMessage!({
                type: 2 /** MessageType.LoadLoc */
            });
        };

        let _loadLocResolveFunc: () => void;
        context.onDidReceiveMessage((e) => {
            switch (e.type) {
                case 1:
                    if (!isReady) {
                        // renderer activates before extension
                        requestLocalization();
                    }
                    break;
                case 2:
                    // load localization
                    Localizations = {
                        ...Localizations,
                        ...e.data
                    };
                    isReady = true;
                    _loadLocResolveFunc();
                    break;
                case 'dataWranglerIsAvailable':
                    context.setState({ isDataWranglerAvailable: true });
                    break;
            }
        });

        requestLocalization();
    }

    return {
        renderOutputItem: async (outputItem: OutputItem, element: HTMLElement) => {
            const isDataWranglerAvailable = context.getState()?.isDataWranglerAvailable;

            // prefer the default renderer if it's available and Data Wrangler is not available
            if (!isDataWranglerAvailable && defaultRenderer) {
                defaultRenderer.renderOutputItem(outputItem, element);
            } else {
                // if for some reason the default renderer isn't available, we should
                // still try to fall back to our renderer for extra insurance
                ReactDOM.render(
                    React.createElement(DataWranglerHtmlRenderer, {
                        outputItem,
                        context,
                        getLocalizedStrings: () => Localizations,
                        defaultRenderer
                    }),
                    element
                );
            }
        },
        disposeOutputItem: (id) => {
            context.postMessage?.({
                type: 'dispose'
            });
            defaultRenderer?.disposeOutputItem?.(id);
        }
    };
};
