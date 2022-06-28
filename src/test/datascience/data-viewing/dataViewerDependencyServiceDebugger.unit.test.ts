// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import { SemVer } from 'semver';
import * as path from '../../../platform/vscode-path/path';
import { instance, mock, verify } from 'ts-mockito';
import { ApplicationShell } from '../../../platform/common/application/applicationShell';
import { IApplicationShell } from '../../../platform/common/application/types';
import {
    DataViewerDependencyService,
    debuggerGetPandasVersion
} from '../../../webviews/extension-side/dataviewer/dataViewerDependencyService';
import { DataScience } from '../../../platform/common/utils/localize';
import { IJupyterVariables } from '../../../kernels/variables/types';
import { Uri } from 'vscode';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';

suite('DataScience - DataViewerDependencyService with debugger', () => {
    let dependencyService: DataViewerDependencyService;
    let appShell: IApplicationShell;
    let variableProvider: IJupyterVariables;
    let interpreter: PythonEnvironment;

    setup(async () => {
        interpreter = {
            displayName: '',
            uri: Uri.file(path.join('users', 'python', 'bin', 'python.exe')),
            sysPrefix: '',
            sysVersion: '',
            version: new SemVer('3.3.3')
        };
        appShell = mock(ApplicationShell);
        variableProvider = instance(mock<IJupyterVariables>());
        dependencyService = new DataViewerDependencyService(instance(appShell), false, variableProvider);
    });

    test('All ok, if pandas is installed and version is > 1.20', async () => {
        const totalParams: string[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (variableProvider as any).evaluate = async (command: string) => {
            totalParams.push(command);
            return { result: '0.30.0' };
        };

        const result = await dependencyService.checkAndInstallMissingDependencies({ interpreter });
        assert.equal(result, undefined);

        assert.deepEqual(totalParams, debuggerGetPandasVersion);
    });

    test('Throw exception if pandas is installed and version is = 0.20', async () => {
        const totalParams: string[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (variableProvider as any).evaluate = async (command: string) => {
            totalParams.push(command);
            return { result: '0.20.0' };
        };

        const promise = dependencyService.checkAndInstallMissingDependencies({ interpreter });

        await assert.isRejected(promise, DataScience.pandasTooOldForViewingFormat().format('0.20.'));

        assert.deepEqual(totalParams, debuggerGetPandasVersion);
    });

    test('Throw exception if pandas is installed and version is < 0.20', async () => {
        const totalParams: string[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (variableProvider as any).evaluate = async (command: string) => {
            totalParams.push(command);
            return { result: '0.10.0' };
        };

        const promise = dependencyService.checkAndInstallMissingDependencies({ interpreter });

        await assert.isRejected(promise, DataScience.pandasTooOldForViewingFormat().format('0.10.'));

        assert.deepEqual(totalParams, debuggerGetPandasVersion);
    });

    test('Prompt to install pandas and throw error', async () => {
        const totalParams: string[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (variableProvider as any).evaluate = async (command: string) => {
            totalParams.push(command);
            throw new Error('Module Not Found: Pandas');
        };

        const promise = dependencyService.checkAndInstallMissingDependencies({ interpreter });

        await assert.isRejected(promise, DataScience.pandasRequiredForViewing());
        verify(appShell.showErrorMessage(DataScience.pandasRequiredForViewing())).once();

        assert.deepEqual(totalParams, [debuggerGetPandasVersion[0]]);
    });
});
