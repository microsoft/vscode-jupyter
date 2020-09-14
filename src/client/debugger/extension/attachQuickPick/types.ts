// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { QuickPickItem, Uri } from 'vscode';

export type ProcessListCommand = { command: string; args: string[] };

export interface IAttachItem extends QuickPickItem {
    id: string;
    processName: string;
    commandLine: string;
}

export interface IAttachProcessProvider {
    getAttachItems(): Promise<IAttachItem[]>;
}

export interface IAttachPicker {
    showQuickPick(): Promise<string>;
}

export interface IRefreshButton {
    iconPath: { light: string | Uri; dark: string | Uri };
    tooltip: string;
}

export const REFRESH_BUTTON_ICON = 'refresh.svg';
