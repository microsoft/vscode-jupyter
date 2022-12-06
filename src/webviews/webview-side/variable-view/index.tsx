// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

// This must be on top, do not change. Required by webpack.
import '../common/main';
// This must be on top, do not change. Required by webpack.

// eslint-disable-next-line import/order
import '../common/index.css';

import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { Provider } from 'react-redux';

import { IVsCodeApi, PostOffice } from '../react-common/postOffice';
import { detectBaseTheme } from '../react-common/themeDetector';
import { createStore } from './redux/store';
import { getConnectedVariableViewPanel } from './variableViewPanel';

// This special function talks to vscode from a web panel
export declare function acquireVsCodeApi(): IVsCodeApi;
const baseTheme = detectBaseTheme();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const testMode = (window as any).inTestMode;
// eslint-disable-next-line
const skipDefault = testMode ? false : typeof acquireVsCodeApi !== 'undefined';

// Create the redux store
const postOffice = new PostOffice();
const store = createStore(skipDefault, baseTheme, testMode, postOffice);

// Create a variable view panel connected to the redux store
const ConnectedVariableViewPanel = getConnectedVariableViewPanel();

/* eslint-disable  */
ReactDOM.render(
    <Provider store={store}>
        <ConnectedVariableViewPanel />
    </Provider>,
    document.getElementById('root') as HTMLElement
);
