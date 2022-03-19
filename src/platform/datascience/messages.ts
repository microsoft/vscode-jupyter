// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

export enum CssMessages {
    GetCssRequest = 'get_css_request',
    GetCssResponse = 'get_css_response'
}

export enum SharedMessages {
    UpdateSettings = 'update_settings',
    Started = 'started',
    LocInit = 'loc_init'
}

export interface IGetCssRequest {
    isDark: boolean;
}

export interface IGetCssResponse {
    css: string;
    theme: string;
}
