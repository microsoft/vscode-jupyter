// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../common/extensions';

export const LineQueryRegex = /line=(\d+)/;

// The following list of commands represent those that can be executed
// in a markdown cell using the syntax: https://command:[my.vscode.command].
export const linkCommandAllowList = [
    'jupyter.latestExtension',
    'jupyter.enableLoadingWidgetScriptsFromThirdPartySource'
];
