// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const jquery = require('slickgrid/lib/jquery-1.11.2.min');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).jQuery = jquery;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).$ = jquery;

// eslint-disable-next-line import/order
import '../common/index.css';

import * as React from 'react';
import * as ReactDOM from 'react-dom';

import { IVsCodeApi } from '../react-common/postOffice';
import { detectBaseTheme } from '../react-common/themeDetector';
import { MainPanel } from './mainPanel';

// This special function talks to vscode from a web panel
export declare function acquireVsCodeApi(): IVsCodeApi;

const baseTheme = detectBaseTheme();

/* eslint-disable  */
ReactDOM.render(
    <MainPanel baseTheme={baseTheme} skipDefault={typeof acquireVsCodeApi !== 'undefined'} />, // Turn this back off when we have real variable explorer data
    document.getElementById('root') as HTMLElement
);
