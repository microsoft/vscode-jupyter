// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { IApplicationShell } from '../../../platform/common/application/types';
import { JVSC_EXTENSION_ID } from '../../../platform/common/constants';
import { IExtensionTestApi } from '../../common';

suite('Web Extension Smoke Test Suite', () => {
    let extensionApi: IExtensionTestApi;

    suiteSetup(async () => {
        const extension = vscode.extensions.getExtension<IExtensionTestApi>(JVSC_EXTENSION_ID)!;
        const api = await extension.activate();
        await api.ready;
        extensionApi = api;
    });

    test('Verify containers', () => {
        const appShell = extensionApi.serviceManager?.get<IApplicationShell>(IApplicationShell);
        assert.ok(appShell, 'Dependency Injection container not initialized in web context');
    });
});
