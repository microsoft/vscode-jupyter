/* eslint-disable @typescript-eslint/no-explicit-any */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { assert } from 'chai';
import { Uri } from 'vscode';
import { IWorkspaceService } from '../../../../../platform/common/application/types';
import { disposeAllDisposables } from '../../../../../platform/common/helpers';
import { IDisposable } from '../../../../../platform/common/types';
import { isWeb } from '../../../../../platform/common/utils/misc';
import { CustomEnvironmentVariablesProvider } from '../../../../../platform/common/variables/customEnvironmentVariablesProvider.node';
import { IEnvironmentVariablesService } from '../../../../../platform/common/variables/types';
import { IS_REMOTE_NATIVE_TEST } from '../../../../constants';
import { initialize } from '../../../../initialize';
import * as fs from 'fs-extra';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../../../../constants.node';
import * as dedent from 'dedent';
import { IPythonExtensionChecker } from '../../../../../platform/api/types';
import { captureScreenShot, createEventHandler } from '../../../../common';
// import * as path from '../../../../../platform/vscode-path/path';

suite('Custom Environment Variables Provider', () => {
    let customEnvVarsProvider: CustomEnvironmentVariablesProvider;
    let envVarsService: IEnvironmentVariablesService;
    const disposables: IDisposable[] = [];
    let workspace: IWorkspaceService;
    let pythonExtChecker: IPythonExtensionChecker;
    const envFile = Uri.joinPath(Uri.file(EXTENSION_ROOT_DIR_FOR_TESTS), 'src', 'test', 'datascience', '.env');
    let contentsOfOldEnvFile: string;
    let customPythonEnvFile = Uri.joinPath(
        Uri.file(EXTENSION_ROOT_DIR_FOR_TESTS),
        'src',
        'test',
        'datascience',
        '.env.python'
    );
    suiteSetup(async function () {
        if (IS_REMOTE_NATIVE_TEST() || isWeb()) {
            return this.skip();
        }
        const api = await initialize();
        envVarsService = api.serviceContainer.get<IEnvironmentVariablesService>(IEnvironmentVariablesService);
        workspace = api.serviceContainer.get<IWorkspaceService>(IWorkspaceService);
        pythonExtChecker = api.serviceContainer.get<IPythonExtensionChecker>(IPythonExtensionChecker);
        contentsOfOldEnvFile = fs.readFileSync(envFile.fsPath).toString();
        await workspace
            .getConfiguration('python', workspace.workspaceFolders![0].uri)
            .update('envFile', '${workspaceFolder}/.env.python');
    });
    suiteTeardown(async function () {
        if (IS_REMOTE_NATIVE_TEST() || isWeb()) {
            return;
        }
        fs.writeFileSync(envFile.fsPath, contentsOfOldEnvFile);
        await workspace
            .getConfiguration('python', workspace.workspaceFolders![0].uri)
            .update('envFile', '${workspaceFolder}/.env');
    });
    setup(() => createProvider());
    teardown(async function () {
        if (this.currentTest?.isFailed()) {
            await captureScreenShot(this);
        }

        disposeAllDisposables(disposables);
        if (fs.existsSync(customPythonEnvFile.fsPath)) {
            fs.unlinkSync(customPythonEnvFile.fsPath);
        }
    });

    function createProvider(cacheDuration?: number) {
        customEnvVarsProvider = new CustomEnvironmentVariablesProvider(
            envVarsService,
            disposables,
            workspace,
            pythonExtChecker,
            cacheDuration
        );
    }
    test('Loads .env file', async () => {
        const envVars = dedent`
                    VSCODE_JUPYTER_ENV_TEST_VAR1=FOO
                    VSCODE_JUPYTER_ENV_TEST_VAR2=BAR
                    `;
        fs.writeFileSync(envFile.fsPath, envVars);
        createProvider();
        const vars = await customEnvVarsProvider.getCustomEnvironmentVariables(undefined, 'RunNonPythonCode');

        assert.deepEqual(vars, {
            VSCODE_JUPYTER_ENV_TEST_VAR1: 'FOO',
            VSCODE_JUPYTER_ENV_TEST_VAR2: 'BAR'
        });
    });
    test('Detects changes to .env file', async () => {
        let envVars = dedent`
                    VSCODE_JUPYTER_ENV_TEST_VAR1=FOO
                    VSCODE_JUPYTER_ENV_TEST_VAR2=BAR
                    `;
        fs.writeFileSync(envFile.fsPath, envVars);
        createProvider();
        let vars = await customEnvVarsProvider.getCustomEnvironmentVariables(undefined, 'RunNonPythonCode');

        assert.deepEqual(vars, {
            VSCODE_JUPYTER_ENV_TEST_VAR1: 'FOO',
            VSCODE_JUPYTER_ENV_TEST_VAR2: 'BAR'
        });

        // Change the .env file.
        const changeDetected = createEventHandler(
            customEnvVarsProvider,
            'onDidEnvironmentVariablesChange',
            disposables
        );
        // const pattern = new RelativePattern(Uri.file(path.dirname(envFile.fsPath)), path.basename(envFile.fsPath));
        // console.error('RegEx Pattern', pattern);
        // console.error('RegEx Pattern', pattern.baseUri);
        // console.error('RegEx Pattern', pattern.pattern);
        // const envFileWatcher = workspace.createFileSystemWatcher(pattern, false, false, false);
        // envFileWatcher.onDidChange(
        //     (e) => {
        //         console.error(`Change detected in ${e.fsPath}`);
        //     },
        //     this,
        //     disposables
        // );
        // envFileWatcher.onDidCreate(
        //     (e) => {
        //         console.error(`Create detected in ${e.fsPath}`);
        //     },
        //     this,
        //     disposables
        // );
        // envFileWatcher.onDidDelete(
        //     (e) => {
        //         console.error(`Delete detected in ${e.fsPath}`);
        //     },
        //     this,
        //     disposables
        // );
        envVars = dedent`
                    VSCODE_JUPYTER_ENV_TEST_VAR1=FOO2
                    VSCODE_JUPYTER_ENV_TEST_VAR2=BAR2
                    `;
        fs.writeFileSync(envFile.fsPath, envVars);

        // Detect the change.
        await changeDetected.assertFired(5_000);

        // Ensure the new vars are different.
        vars = await customEnvVarsProvider.getCustomEnvironmentVariables(undefined, 'RunNonPythonCode');
        assert.deepEqual(vars, {
            VSCODE_JUPYTER_ENV_TEST_VAR1: 'FOO2',
            VSCODE_JUPYTER_ENV_TEST_VAR2: 'BAR2'
        });
    });
    test('Detects creation of the .env file', async () => {
        fs.unlinkSync(envFile.fsPath);
        let vars = await customEnvVarsProvider.getCustomEnvironmentVariables(undefined, 'RunNonPythonCode');
        assert.isEmpty(vars || {});

        // Create the .env file.
        const changeDetected = createEventHandler(
            customEnvVarsProvider,
            'onDidEnvironmentVariablesChange',
            disposables
        );
        const envVars = dedent`
                    VSCODE_JUPYTER_ENV_TEST_VAR1=FOO2
                    VSCODE_JUPYTER_ENV_TEST_VAR2=BAR2
                    `;
        fs.writeFileSync(envFile.fsPath, envVars);

        // Detect the change.
        await changeDetected.assertFired(5_000);

        // Ensure the new vars are different.
        vars = await customEnvVarsProvider.getCustomEnvironmentVariables(undefined, 'RunNonPythonCode');
        assert.deepEqual(vars, {
            VSCODE_JUPYTER_ENV_TEST_VAR1: 'FOO2',
            VSCODE_JUPYTER_ENV_TEST_VAR2: 'BAR2'
        });
    });
    test('Loads python.env file', async () => {
        const envVars = dedent`
                    VSCODE_JUPYTER_ENV_TEST_VAR1=FOO
                    VSCODE_JUPYTER_ENV_TEST_VAR2=BAR
                    `;
        fs.writeFileSync(envFile.fsPath, envVars);
        const pythonEnvVars = dedent`
                    VSCODE_JUPYTER_ENV_TEST_VAR1=PYTHON_FOO
                    VSCODE_JUPYTER_ENV_TEST_VAR2=PYTHON_BAR
                    `;
        fs.writeFileSync(customPythonEnvFile.fsPath, pythonEnvVars);
        createProvider();
        const vars = await customEnvVarsProvider.getCustomEnvironmentVariables(undefined, 'RunNonPythonCode');
        const pythonVars = await customEnvVarsProvider.getCustomEnvironmentVariables(undefined, 'RunPythonCode');

        assert.deepEqual(vars, {
            VSCODE_JUPYTER_ENV_TEST_VAR1: 'FOO',
            VSCODE_JUPYTER_ENV_TEST_VAR2: 'BAR'
        });
        assert.deepEqual(pythonVars, {
            VSCODE_JUPYTER_ENV_TEST_VAR1: 'PYTHON_FOO',
            VSCODE_JUPYTER_ENV_TEST_VAR2: 'PYTHON_BAR'
        });
    });
    test('Detects changes to python.env file', async () => {
        let envVars = dedent`
                    VSCODE_JUPYTER_ENV_TEST_VAR1=FOO
                    VSCODE_JUPYTER_ENV_TEST_VAR2=BAR
                    `;
        fs.writeFileSync(customPythonEnvFile.fsPath, envVars);
        createProvider();
        let vars = await customEnvVarsProvider.getCustomEnvironmentVariables(undefined, 'RunPythonCode');

        assert.deepEqual(vars, {
            VSCODE_JUPYTER_ENV_TEST_VAR1: 'FOO',
            VSCODE_JUPYTER_ENV_TEST_VAR2: 'BAR'
        });

        // Change the .env file.
        const changeDetected = createEventHandler(
            customEnvVarsProvider,
            'onDidEnvironmentVariablesChange',
            disposables
        );
        envVars = dedent`
                    VSCODE_JUPYTER_ENV_TEST_VAR1=FOO2
                    VSCODE_JUPYTER_ENV_TEST_VAR2=BAR2
                    `;
        fs.writeFileSync(customPythonEnvFile.fsPath, envVars);

        // Detect the change.
        await changeDetected.assertFired(5_000);

        // Ensure the new vars are different.
        vars = await customEnvVarsProvider.getCustomEnvironmentVariables(undefined, 'RunPythonCode');
        assert.deepEqual(vars, {
            VSCODE_JUPYTER_ENV_TEST_VAR1: 'FOO2',
            VSCODE_JUPYTER_ENV_TEST_VAR2: 'BAR2'
        });
    });
    test('Detects creation of the python.env file', async () => {
        let vars = await customEnvVarsProvider.getCustomEnvironmentVariables(undefined, 'RunPythonCode');
        assert.isEmpty(vars || {});

        // Create the .env file.
        const changeDetected = createEventHandler(
            customEnvVarsProvider,
            'onDidEnvironmentVariablesChange',
            disposables
        );
        const envVars = dedent`
                    VSCODE_JUPYTER_ENV_TEST_VAR1=FOO2
                    VSCODE_JUPYTER_ENV_TEST_VAR2=BAR2
                    `;
        fs.writeFileSync(customPythonEnvFile.fsPath, envVars);

        // Detect the change.
        await changeDetected.assertFired(5_000);

        // Ensure the new vars are different.
        vars = await customEnvVarsProvider.getCustomEnvironmentVariables(undefined, 'RunPythonCode');
        assert.deepEqual(vars, {
            VSCODE_JUPYTER_ENV_TEST_VAR1: 'FOO2',
            VSCODE_JUPYTER_ENV_TEST_VAR2: 'BAR2'
        });
    });
});
