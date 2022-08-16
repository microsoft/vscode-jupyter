// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { assert } from 'chai';
import { ConfigurationChangeEvent, EventEmitter, FileSystemWatcher, Uri, WorkspaceConfiguration } from 'vscode';
import { IWorkspaceService } from '../../../../../platform/common/application/types';
import { disposeAllDisposables } from '../../../../../platform/common/helpers';
import { IDisposable, IExtensionContext, IHttpClient } from '../../../../../platform/common/types';
import { CustomEnvironmentVariablesProvider } from '../../../../../platform/common/variables/customEnvironmentVariablesProvider.node';
import { IEnvironmentVariablesService } from '../../../../../platform/common/variables/types';
import * as fs from 'fs-extra';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../../../../constants.node';
import dedent from 'dedent';
import { IPythonExtensionChecker } from '../../../../../platform/api/types';
import { captureScreenShot, createEventHandler } from '../../../../common';
import { traceInfo } from '../../../../../platform/logging';
import { anything, instance, mock, when } from 'ts-mockito';
import { clearCache } from '../../../../../platform/common/utils/cacheUtils';
import { EnvironmentVariablesService } from '../../../../../platform/common/variables/environment.node';
import { FileSystem } from '../../../../../platform/common/platform/fileSystem.node';
import * as sinon from 'sinon';
// import * as path from '../../../../../platform/vscode-path/path';

suite('Custom Environment Variables Provider', () => {
    let customEnvVarsProvider: CustomEnvironmentVariablesProvider;
    let envVarsService: IEnvironmentVariablesService;
    const disposables: IDisposable[] = [];
    let workspace: IWorkspaceService;
    let pythonExtChecker: IPythonExtensionChecker;
    const envFile = Uri.joinPath(Uri.file(EXTENSION_ROOT_DIR_FOR_TESTS), 'src', 'test', 'datascience', '.env');
    let contentsOfOldEnvFile: string;
    let onDidChangeConfiguration: EventEmitter<ConfigurationChangeEvent>;
    let customPythonEnvFile = Uri.joinPath(
        Uri.file(EXTENSION_ROOT_DIR_FOR_TESTS),
        'src',
        'test',
        'datascience',
        '.env.python'
    );
    let onFSEvent: EventEmitter<Uri>;
    let fsWatcher: FileSystemWatcher;
    const workspaceUri = Uri.joinPath(Uri.file(EXTENSION_ROOT_DIR_FOR_TESTS), 'src', 'test', 'datascience');
    const workspaceFolder = { index: 0, name: 'workspace', uri: workspaceUri };
    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        clearCache();
        envVarsService = new EnvironmentVariablesService(
            new FileSystem(instance(mock<IExtensionContext>()), instance(mock<IHttpClient>()))
        );
        pythonExtChecker = mock<IPythonExtensionChecker>();
        when(pythonExtChecker.isPythonExtensionInstalled).thenReturn(true);
        contentsOfOldEnvFile = fs.readFileSync(envFile.fsPath).toString();
        onDidChangeConfiguration = new EventEmitter<ConfigurationChangeEvent>();
        disposables.push(onDidChangeConfiguration);
        workspace = mock<IWorkspaceService>();
        onFSEvent = new EventEmitter<Uri>();
        disposables.push(onFSEvent);
        fsWatcher = mock<FileSystemWatcher>();
        when(fsWatcher.dispose()).thenReturn();
        when(fsWatcher.onDidChange).thenReturn(onFSEvent.event);
        when(fsWatcher.onDidCreate).thenReturn(onFSEvent.event);
        when(fsWatcher.onDidDelete).thenReturn(onFSEvent.event);
        when(workspace.onDidChangeConfiguration).thenReturn(onDidChangeConfiguration.event);
        when(workspace.workspaceFolders).thenReturn([workspaceFolder]);
        when(workspace.getWorkspaceFolder(anything())).thenCall(() => workspaceFolder);
        when(workspace.getConfiguration(anything(), anything())).thenCall(() => {
            const workspaceConfig = mock<WorkspaceConfiguration>();
            when(workspaceConfig.get<string>('envFile')).thenReturn('${workspaceFolder}/.env.python');
            return instance(workspaceConfig);
        });
        when(workspace.getWorkspaceFolderIdentifier(anything())).thenCall(() => workspaceFolder.uri.fsPath);
        when(workspace.createFileSystemWatcher(anything(), anything(), anything(), anything())).thenReturn(
            instance(fsWatcher)
        );
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        if (this.currentTest?.isFailed()) {
            await captureScreenShot(this);
        }

        disposeAllDisposables(disposables);
        if (fs.existsSync(customPythonEnvFile.fsPath)) {
            fs.unlinkSync(customPythonEnvFile.fsPath);
        }
        fs.writeFileSync(envFile.fsPath, contentsOfOldEnvFile);
        sinon.restore();
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });

    function createProvider(cacheDuration?: number) {
        customEnvVarsProvider = new CustomEnvironmentVariablesProvider(
            envVarsService,
            disposables,
            instance(workspace),
            pythonExtChecker,
            cacheDuration
        );
    }
    test('Loads .env file', async () => {
        const fsSpy = sinon.spy(FileSystem.prototype, 'readFile');
        const envVars = dedent`
                    VSCODE_JUPYTER_ENV_TEST_VAR1=FOO
                    VSCODE_JUPYTER_ENV_TEST_VAR2=BAR
                    `;
        traceInfo('Write to env file', envFile.fsPath);
        fs.writeFileSync(envFile.fsPath, envVars);
        createProvider();
        const vars = await customEnvVarsProvider.getCustomEnvironmentVariables(undefined, 'RunNonPythonCode');

        assert.deepEqual(vars, {
            VSCODE_JUPYTER_ENV_TEST_VAR1: 'FOO',
            VSCODE_JUPYTER_ENV_TEST_VAR2: 'BAR'
        });

        // Reading again doesn't require a new read of the file.
        const originalCalLCount = fsSpy.callCount;
        const vars2 = await customEnvVarsProvider.getCustomEnvironmentVariables(undefined, 'RunNonPythonCode');

        assert.strictEqual(fsSpy.callCount, originalCalLCount);
        assert.deepEqual(vars2, {
            VSCODE_JUPYTER_ENV_TEST_VAR1: 'FOO',
            VSCODE_JUPYTER_ENV_TEST_VAR2: 'BAR'
        });
    });
    test('Detects changes to .env file', async () => {
        let envVars = dedent`
                    VSCODE_JUPYTER_ENV_TEST_VAR1=FOO
                    VSCODE_JUPYTER_ENV_TEST_VAR2=BAR
                    `;
        traceInfo('Write to env file1', envFile.fsPath);
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
        envVars = dedent`
                    VSCODE_JUPYTER_ENV_TEST_VAR1=FOO2
                    VSCODE_JUPYTER_ENV_TEST_VAR2=BAR2
                    `;
        traceInfo('Write to env file2', envFile.fsPath);
        fs.writeFileSync(envFile.fsPath, envVars);
        onFSEvent.fire(envFile);

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
        traceInfo('Delete to env file', envFile.fsPath);
        fs.unlinkSync(envFile.fsPath);
        createProvider();
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
        traceInfo('Create env file', envFile.fsPath);
        fs.writeFileSync(envFile.fsPath, envVars);
        onFSEvent.fire(envFile);

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
        traceInfo('Write to env file', envFile.fsPath);
        fs.writeFileSync(envFile.fsPath, envVars);
        const pythonEnvVars = dedent`
                    VSCODE_JUPYTER_ENV_TEST_VAR1=PYTHON_FOO
                    VSCODE_JUPYTER_ENV_TEST_VAR2=PYTHON_BAR
                    `;
        traceInfo('Write to python env file', customPythonEnvFile.fsPath);
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
        traceInfo('Write to env file', customPythonEnvFile.fsPath);
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
        traceInfo('Write to env file 2', customPythonEnvFile.fsPath);
        fs.writeFileSync(customPythonEnvFile.fsPath, envVars);
        onFSEvent.fire(customPythonEnvFile);

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
        createProvider();

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
        traceInfo('Write to Python env file', customPythonEnvFile.fsPath);
        fs.writeFileSync(customPythonEnvFile.fsPath, envVars);
        onFSEvent.fire(customPythonEnvFile);

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
