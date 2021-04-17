// Copyright (c) Microsoft Corporation. All rights reserved.
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
import { getConnectedContextualPanel } from './contextualPanel';
import { createStore } from './redux/store';

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

// Wire up a connected react control for our ScratchEditor
const ConnectedContextualPanel = getConnectedContextualPanel();

// Stick them all together
/* eslint-disable  */
ReactDOM.render(
    <Provider store={store}>
        <ConnectedContextualPanel />
    </Provider>,
    document.getElementById('root') as HTMLElement
);
