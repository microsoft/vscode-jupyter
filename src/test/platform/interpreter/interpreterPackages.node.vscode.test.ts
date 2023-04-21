// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { workspace } from 'vscode';
import { isWeb } from '../../../platform/common/utils/misc';
import { IInterpreterPackages } from '../../../platform/interpreter/types';
import { startJupyterServer } from '../../common';
import { IS_REMOTE_NATIVE_TEST } from '../../constants';
import { initialize } from '../../initialize';

suite('Interpreter Packages @python', () => {
    let packages: IInterpreterPackages;
    suiteSetup(async function () {
        if (IS_REMOTE_NATIVE_TEST() || isWeb()) {
            return this.skip();
        }
        const api = await initialize();
        packages = api.serviceContainer.get<IInterpreterPackages>(IInterpreterPackages);
        await startJupyterServer();
    });
    test('Returns installed modules', async function () {
        const uri = workspace.workspaceFolders?.length ? workspace.workspaceFolders[0].uri : undefined;
        const installedModules = new Set((await packages.listPackages(uri)).map((item) => item.toLowerCase()));

        assert.isTrue(installedModules.has('xml'));
        assert.isTrue(installedModules.has('os'));
        assert.isTrue(installedModules.has('random'));

        assert.isTrue(installedModules.has('ipykernel')); // Installed on CI
        assert.isTrue(installedModules.has('matplotlib')); // Installed on CI
    });
});
