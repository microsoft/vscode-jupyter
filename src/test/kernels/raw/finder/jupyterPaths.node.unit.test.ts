// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable local-rules/dont-use-process */

import { assert } from 'chai';
import { anything, deepEqual, instance, mock, when } from 'ts-mockito';
import { CancellationTokenSource, ExtensionContext, Memento, Uri } from 'vscode';
import { CACHE_KEY_FOR_JUPYTER_KERNEL_PATHS, JupyterPaths } from '../../../../kernels/raw/finder/jupyterPaths.node';
import { disposeAllDisposables } from '../../../../platform/common/helpers';
import { IFileSystem, IPlatformService } from '../../../../platform/common/platform/types';
import { IPythonExecutionFactory, IPythonExecutionService } from '../../../../platform/common/process/types.node';
import { IDisposable } from '../../../../platform/common/types';
import { isWeb } from '../../../../platform/common/utils/misc';
import { OSType } from '../../../../platform/common/utils/platform';
import { ICustomEnvironmentVariablesProvider } from '../../../../platform/common/variables/types';
import { PythonEnvironment } from '../../../../platform/pythonEnvironments/info';
import * as path from '../../../../platform/vscode-path/path';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../../../constants.node';
import { uriEquals } from '../../../datascience/helpers';

suite('Jupyter Paths', () => {
    const disposables: IDisposable[] = [];
    let jupyterPaths: JupyterPaths;
    let platformService: IPlatformService;
    let envVarsProvider: ICustomEnvironmentVariablesProvider;
    let memento: Memento;
    let fs: IFileSystem;
    let context: ExtensionContext;
    let pythonExecService: IPythonExecutionService;
    const oldJUPYTER_PATH = process.env['JUPYTER_PATH'];
    const oldAPPDATA = process.env['APPDATA'];
    const oldPROGRAMDATA = process.env['PROGRAMDATA'];
    const oldJUPYTER_CONFIG_DIR = process.env['JUPYTER_CONFIG_DIR'];
    const oldJUPYTER_DATA_DIR = process.env['JUPYTER_DATA_DIR'];
    const oldALLUSERSPROFILE = process.env['ALLUSERSPROFILE'];
    const windowsHomeDir = Uri.file('C:/users/username');
    const extensionUri = Uri.file('extension');
    const interpreter: PythonEnvironment = {
        sysPrefix: `PythonEnv${path.sep}PythonSysPrefix`,
        uri: Uri.file('PythonEnv'),
        id: Uri.file('PythonEnv').fsPath
    };
    const unixHomeDir = Uri.file('/users/username');
    const macHomeDir = Uri.file('/users/username');
    let cancelToken: CancellationTokenSource;
    suiteSetup(function () {
        if (isWeb()) {
            return this.skip();
        }
    });
    setup(() => {
        cancelToken = new CancellationTokenSource();
        disposables.push(cancelToken);
        const pythonExecFactory = mock<IPythonExecutionFactory>();
        pythonExecService = mock<IPythonExecutionService>();
        (instance(pythonExecService) as any).then = undefined;
        when(pythonExecFactory.createActivatedEnvironment(anything())).thenResolve(instance(pythonExecService));
        platformService = mock<IPlatformService>();
        envVarsProvider = mock<ICustomEnvironmentVariablesProvider>();
        memento = mock<Memento>();
        fs = mock<IFileSystem>();
        context = mock<ExtensionContext>();
        when(context.extensionUri).thenReturn(extensionUri);
        when(envVarsProvider.getEnvironmentVariables(anything(), anything())).thenResolve(process.env);
        jupyterPaths = new JupyterPaths(
            instance(platformService),
            instance(envVarsProvider),
            instance(disposables),
            instance(memento),
            instance(fs),
            instance(context),
            instance(pythonExecFactory)
        );
        delete process.env['JUPYTER_PATH'];
        delete process.env['APPDATA'];
        delete process.env['PROGRAMDATA'];
        delete process.env['JUPYTER_CONFIG_DIR'];
        delete process.env['JUPYTER_DATA_DIR'];
        delete process.env['ALLUSERSPROFILE'];
    });
    teardown(async () => {
        disposeAllDisposables(disposables);
    });
    suiteTeardown(() => {
        process.env['JUPYTER_PATH'] = oldJUPYTER_PATH;
        process.env['APPDATA'] = oldAPPDATA;
        process.env['PROGRAMDATA'] = oldPROGRAMDATA;
        process.env['JUPYTER_CONFIG_DIR'] = oldJUPYTER_CONFIG_DIR;
        process.env['JUPYTER_DATA_DIR'] = oldJUPYTER_DATA_DIR;
        process.env['ALLUSERSPROFILE'] = oldALLUSERSPROFILE;
    });
    test('Get datadir for non-python kernel on Windows with APPDATA', async () => {
        when(platformService.homeDir).thenReturn(windowsHomeDir);
        when(platformService.osType).thenReturn(OSType.Windows);
        const appDataDir = (process.env['APPDATA'] = 'C:/users/username/appDataFolder');
        const dataDirs = await jupyterPaths.getDataDirs({ resource: undefined });

        assert.strictEqual(dataDirs.length, 1);
        assert.strictEqual(dataDirs[0].toString(), Uri.joinPath(Uri.file(appDataDir), 'jupyter').toString());
    });
    test('Get datadir for non-python kernel on Windows with PROGRAMDATA', async () => {
        when(platformService.homeDir).thenReturn(windowsHomeDir);
        when(platformService.osType).thenReturn(OSType.Windows);
        const programDataDir = (process.env['PROGRAMDATA'] = 'C:/programDataFolder');

        const dataDirs = await jupyterPaths.getDataDirs({ resource: undefined });

        assert.strictEqual(dataDirs.length, 2);
        assert.strictEqual(dataDirs[0].toString(), Uri.joinPath(windowsHomeDir, '.jupyter', 'data').toString());
        assert.strictEqual(dataDirs[1].toString(), Uri.joinPath(Uri.file(programDataDir), 'jupyter').toString());
    });
    test('Get datadir for non-python kernel on Windows with APPDATA & PROGRAMDATA', async () => {
        when(platformService.homeDir).thenReturn(windowsHomeDir);
        when(platformService.osType).thenReturn(OSType.Windows);
        const appDataDir = (process.env['APPDATA'] = 'C:/users/username/appDataFolder');
        const programDataDir = (process.env['PROGRAMDATA'] = 'C:/programDataFolder');

        const dataDirs = await jupyterPaths.getDataDirs({ resource: undefined });

        assert.strictEqual(dataDirs.length, 2);
        assert.strictEqual(dataDirs[0].toString(), Uri.joinPath(Uri.file(appDataDir), 'jupyter').toString());
        assert.strictEqual(dataDirs[1].toString(), Uri.joinPath(Uri.file(programDataDir), 'jupyter').toString());
    });
    test('Get datadir for non-python kernel on Windows with JUPYTER_CONFIG_DIR & PROGRAMDATA', async () => {
        when(platformService.homeDir).thenReturn(windowsHomeDir);
        when(platformService.osType).thenReturn(OSType.Windows);
        const programDataDir = (process.env['PROGRAMDATA'] = 'C:/programDataFolder');
        const configDir = (process.env['JUPYTER_CONFIG_DIR'] = 'C:/users/username/.jupyterConfigDir');

        const dataDirs = await jupyterPaths.getDataDirs({ resource: undefined });

        assert.strictEqual(dataDirs.length, 2);
        assert.strictEqual(dataDirs[0].toString(), Uri.joinPath(Uri.file(configDir), 'data').toString());
        assert.strictEqual(dataDirs[1].toString(), Uri.joinPath(Uri.file(programDataDir), 'jupyter').toString());
    });
    test('Get datadir for non-python kernel on Windows with JUPYTER_CONFIG_DIR, PROGRAMDATA & JUPYTER_DATA_DIR', async () => {
        when(platformService.homeDir).thenReturn(windowsHomeDir);
        when(platformService.osType).thenReturn(OSType.Windows);
        const jupyterDataDir = (process.env['JUPYTER_DATA_DIR'] = 'D:/jupyterDataDir');
        const programDataDir = (process.env['PROGRAMDATA'] = 'C:/programDataFolder');
        process.env['JUPYTER_CONFIG_DIR'] = 'C:/users/username/.jupyterConfigDir';

        const dataDirs = await jupyterPaths.getDataDirs({ resource: undefined });

        assert.strictEqual(dataDirs.length, 2);
        assert.strictEqual(dataDirs[0].toString(), Uri.file(jupyterDataDir).toString());
        assert.strictEqual(dataDirs[1].toString(), Uri.joinPath(Uri.file(programDataDir), 'jupyter').toString());
    });

    test('Get datadir for non-python kernel on Windows with JUPYTER_CONFIG_DIR, PROGRAMDATA, JUPYTER_DATA_DIR & JUPYTER_PATH', async () => {
        when(platformService.homeDir).thenReturn(windowsHomeDir);
        when(platformService.osType).thenReturn(OSType.Windows);
        const jupyter_Paths = ['FjupyterDataDir', `CprogramDataFolder${path.sep}jupyter`, 'HsomeOtherFolder'];
        process.env['JUPYTER_PATH'] = jupyter_Paths.join(path.delimiter);
        const jupyterDataDir = (process.env['JUPYTER_DATA_DIR'] = 'D:/jupyterDataDir');
        process.env['PROGRAMDATA'] = 'CprogramDataFolder';
        process.env['JUPYTER_CONFIG_DIR'] = 'C:/users/username/.jupyterConfigDir';

        const dataDirs = await jupyterPaths.getDataDirs({ resource: undefined });

        assert.strictEqual(dataDirs.length, 4);
        assert.strictEqual(dataDirs[0].toString(), Uri.file(jupyter_Paths[0]).toString());
        assert.strictEqual(dataDirs[1].toString(), Uri.file(jupyter_Paths[1]).toString());
        assert.strictEqual(dataDirs[2].toString(), Uri.file(jupyter_Paths[2]).toString());
        assert.strictEqual(dataDirs[3].toString(), Uri.file(jupyterDataDir).toString());
    });

    test('Get datadir for python kernel on Windows with JUPYTER_CONFIG_DIR, PROGRAMDATA, JUPYTER_DATA_DIR & JUPYTER_PATH', async () => {
        when(platformService.homeDir).thenReturn(windowsHomeDir);
        when(platformService.osType).thenReturn(OSType.Windows);
        const jupyter_Paths = ['FjupyterDataDir', `CprogramDataFolder${path.sep}jupyter`, 'HsomeOtherFolder'];
        process.env['JUPYTER_PATH'] = jupyter_Paths.join(path.delimiter);
        const jupyterDataDir = (process.env['JUPYTER_DATA_DIR'] = 'D:/jupyterDataDir');
        process.env['PROGRAMDATA'] = 'CprogramDataFolder';
        process.env['JUPYTER_CONFIG_DIR'] = 'C:/users/username/.jupyterConfigDir';

        const dataDirs = await jupyterPaths.getDataDirs({ resource: undefined, interpreter });

        assert.strictEqual(dataDirs.length, 5);
        assert.strictEqual(dataDirs[0].toString(), Uri.file(jupyter_Paths[0]).toString());
        assert.strictEqual(dataDirs[1].toString(), Uri.file(jupyter_Paths[1]).toString());
        assert.strictEqual(dataDirs[2].toString(), Uri.file(jupyter_Paths[2]).toString());
        assert.strictEqual(dataDirs[3].toString(), Uri.file(jupyterDataDir).toString());
        assert.strictEqual(
            dataDirs[4].toString(),
            Uri.joinPath(Uri.file(interpreter.sysPrefix!), 'share', 'jupyter').toString()
        );
    });

    test('Get datadir for python kernel on Windows with Python DataDir, JUPYTER_CONFIG_DIR, PROGRAMDATA, JUPYTER_DATA_DIR & JUPYTER_PATH', async () => {
        when(platformService.homeDir).thenReturn(windowsHomeDir);
        when(platformService.osType).thenReturn(OSType.Windows);
        const pythonFile = Uri.joinPath(extensionUri, 'pythonFiles', 'printJupyterDataDir.py');
        when(pythonExecService.exec(deepEqual([pythonFile.fsPath]), anything())).thenResolve({
            stdout: 'JupyterDataDirFromPython'
        });
        when(fs.exists(uriEquals('JupyterDataDirFromPython'))).thenResolve(true);
        const jupyter_Paths = ['FjupyterDataDir', `CprogramDataFolder${path.sep}jupyter`, 'HsomeOtherFolder'];
        process.env['JUPYTER_PATH'] = jupyter_Paths.join(path.delimiter);
        const jupyterDataDir = (process.env['JUPYTER_DATA_DIR'] = 'D:/jupyterDataDir');
        process.env['PROGRAMDATA'] = 'CprogramDataFolder';
        process.env['JUPYTER_CONFIG_DIR'] = 'C:/users/username/.jupyterConfigDir';

        const dataDirs = await jupyterPaths.getDataDirs({ resource: undefined, interpreter });

        assert.strictEqual(dataDirs.length, 6);
        assert.strictEqual(dataDirs[0].toString(), Uri.file(jupyter_Paths[0]).toString());
        assert.strictEqual(dataDirs[1].toString(), Uri.file(jupyter_Paths[1]).toString());
        assert.strictEqual(dataDirs[2].toString(), Uri.file(jupyter_Paths[2]).toString());
        assert.strictEqual(dataDirs[3].toString(), Uri.file('JupyterDataDirFromPython').toString());
        assert.strictEqual(dataDirs[4].toString(), Uri.file(jupyterDataDir).toString());
        assert.strictEqual(
            dataDirs[5].toString(),
            Uri.joinPath(Uri.file(interpreter.sysPrefix!), 'share', 'jupyter').toString()
        );
    });

    test('Get datadir for non-python kernel on Unix', async () => {
        when(platformService.homeDir).thenReturn(unixHomeDir);
        when(platformService.osType).thenReturn(OSType.Linux);

        const dataDirs = await jupyterPaths.getDataDirs({ resource: undefined });

        assert.strictEqual(dataDirs.length, 1);
        assert.strictEqual(dataDirs[0].toString(), Uri.joinPath(unixHomeDir, '.local', 'share', 'jupyter').toString());
    });
    test('Get datadir for non-python kernel on Unix with JUPYTER_DATA_DIR', async () => {
        when(platformService.homeDir).thenReturn(unixHomeDir);
        when(platformService.osType).thenReturn(OSType.Linux);
        const jupyterDataDir = (process.env['JUPYTER_DATA_DIR'] = '/usr/jupyterDataDir');

        const dataDirs = await jupyterPaths.getDataDirs({ resource: undefined });

        assert.strictEqual(dataDirs.length, 1);
        assert.strictEqual(dataDirs[0].toString(), Uri.file(jupyterDataDir).toString());
    });
    test('Get datadir for non-python kernel on Unix with JUPYTER_DATA_DIR & XDG_DATA_HOME', async () => {
        when(platformService.homeDir).thenReturn(unixHomeDir);
        when(platformService.osType).thenReturn(OSType.Linux);
        const xdgDataHome = (process.env['XDG_DATA_HOME'] = '/usr/xdgDataHome');

        const dataDirs = await jupyterPaths.getDataDirs({ resource: undefined });

        assert.strictEqual(dataDirs.length, 1);
        assert.strictEqual(dataDirs[0].toString(), Uri.joinPath(Uri.file(xdgDataHome), 'jupyter').toString());
    });

    test('Get datadir for non-python kernel on Mac', async () => {
        when(platformService.homeDir).thenReturn(macHomeDir);
        when(platformService.osType).thenReturn(OSType.OSX);

        const dataDirs = await jupyterPaths.getDataDirs({ resource: undefined });

        assert.strictEqual(dataDirs.length, 1);
        assert.strictEqual(dataDirs[0].toString(), Uri.joinPath(macHomeDir, 'Library', 'Jupyter').toString());
    });
    test('Get datadir for non-python kernel on mac with JUPYTER_DATA_DIR', async () => {
        when(platformService.homeDir).thenReturn(macHomeDir);
        when(platformService.osType).thenReturn(OSType.OSX);
        const jupyterDataDir = (process.env['JUPYTER_DATA_DIR'] = '/usr/jupyterDataDir');

        const dataDirs = await jupyterPaths.getDataDirs({ resource: undefined });

        assert.strictEqual(dataDirs.length, 1);
        assert.strictEqual(dataDirs[0].toString(), Uri.file(jupyterDataDir).toString());
    });
    test('Get datadir for python kernel on mac with JUPYTER_DATA_DIR', async () => {
        when(platformService.homeDir).thenReturn(macHomeDir);
        when(platformService.osType).thenReturn(OSType.OSX);
        const jupyterDataDir = (process.env['JUPYTER_DATA_DIR'] = '/usr/jupyterDataDir');

        const dataDirs = await jupyterPaths.getDataDirs({ resource: undefined, interpreter });

        assert.strictEqual(dataDirs.length, 2);
        assert.strictEqual(dataDirs[0].toString(), Uri.file(jupyterDataDir).toString());
        assert.strictEqual(
            dataDirs[1].toString(),
            Uri.joinPath(Uri.file(interpreter.sysPrefix!), 'share', 'jupyter').toString()
        );
    });
    test('Get datadir for python kernel on mac with Python DataDir, JUPYTER_CONFIG_DIR, PROGRAMDATA, JUPYTER_DATA_DIR & JUPYTER_PATH', async () => {
        when(platformService.homeDir).thenReturn(macHomeDir);
        when(platformService.osType).thenReturn(OSType.OSX);
        const pythonFile = Uri.joinPath(extensionUri, 'pythonFiles', 'printJupyterDataDir.py');
        when(pythonExecService.exec(deepEqual([pythonFile.fsPath]), anything())).thenResolve({
            stdout: 'JupyterDataDirFromPython'
        });
        when(fs.exists(uriEquals('JupyterDataDirFromPython'))).thenResolve(true);
        const jupyter_Paths = ['FjupyterDataDir', `CprogramDataFolder${path.sep}jupyter`, 'HsomeOtherFolder'];
        process.env['JUPYTER_PATH'] = jupyter_Paths.join(path.delimiter);
        const jupyterDataDir = (process.env['JUPYTER_DATA_DIR'] = 'D:/jupyterDataDir');
        process.env['PROGRAMDATA'] = 'CprogramDataFolder';
        process.env['JUPYTER_CONFIG_DIR'] = 'C:/users/username/.jupyterConfigDir';

        const dataDirs = await jupyterPaths.getDataDirs({ resource: undefined, interpreter });

        assert.strictEqual(dataDirs.length, 6);
        assert.strictEqual(dataDirs[0].toString(), Uri.file(jupyter_Paths[0]).toString());
        assert.strictEqual(dataDirs[1].toString(), Uri.file(jupyter_Paths[1]).toString());
        assert.strictEqual(dataDirs[2].toString(), Uri.file(jupyter_Paths[2]).toString());
        assert.strictEqual(dataDirs[3].toString(), Uri.file('JupyterDataDirFromPython').toString());
        assert.strictEqual(dataDirs[4].toString(), Uri.file(jupyterDataDir).toString());
        assert.strictEqual(
            dataDirs[5].toString(),
            Uri.joinPath(Uri.file(interpreter.sysPrefix!), 'share', 'jupyter').toString()
        );
    });

    test('Get kernelspec root paths on Windows', async () => {
        when(platformService.osType).thenReturn(OSType.Windows);
        when(platformService.homeDir).thenReturn(windowsHomeDir);
        when(memento.get(CACHE_KEY_FOR_JUPYTER_KERNEL_PATHS, anything())).thenReturn([]);

        const paths = await jupyterPaths.getKernelSpecRootPaths(cancelToken.token);
        const winJupyterPath = path.join('AppData', 'Roaming', 'jupyter', 'kernels');

        assert.strictEqual(paths.length, 1, `Expected 1 path, got ${paths.length}, ${JSON.stringify(paths)}`);
        assert.strictEqual(paths[0].toString(), Uri.joinPath(windowsHomeDir, winJupyterPath).toString());
    });

    test('Get kernelspec root paths on Windows with JUPYTER_PATH env variable', async () => {
        when(platformService.osType).thenReturn(OSType.Windows);
        when(platformService.homeDir).thenReturn(windowsHomeDir);
        when(memento.get(CACHE_KEY_FOR_JUPYTER_KERNEL_PATHS, anything())).thenReturn([]);
        const jupyter_Paths = [__filename];
        process.env['JUPYTER_PATH'] = jupyter_Paths.join(path.delimiter);

        const paths = await jupyterPaths.getKernelSpecRootPaths(cancelToken.token);
        const winJupyterPath = path.join('AppData', 'Roaming', 'jupyter', 'kernels');

        assert.strictEqual(paths.length, 2, `Expected 2 path, got ${paths.length}, ${JSON.stringify(paths)}`);
        assert.strictEqual(paths[0].toString(), Uri.joinPath(Uri.file(__filename), 'kernels').toString());
        assert.strictEqual(paths[1].toString(), Uri.joinPath(windowsHomeDir, winJupyterPath).toString());
    });
    test('Get kernelspec root paths on Windows with JUPYTER_PATH & ALLUSERSPROFILE env variable', async function () {
        when(platformService.osType).thenReturn(OSType.Windows);
        when(platformService.homeDir).thenReturn(windowsHomeDir);
        when(memento.get(CACHE_KEY_FOR_JUPYTER_KERNEL_PATHS, anything())).thenReturn([]);
        const jupyter_Paths = [__filename];
        process.env['JUPYTER_PATH'] = jupyter_Paths.join(path.delimiter);
        const allUserProfilePath = (process.env['PROGRAMDATA'] = path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'temp'));

        const paths = await jupyterPaths.getKernelSpecRootPaths(cancelToken.token);
        const winJupyterPath = path.join('AppData', 'Roaming', 'jupyter', 'kernels');

        assert.strictEqual(paths.length, 3, `Expected 3 path, got ${paths.length}, ${JSON.stringify(paths)}`);
        assert.strictEqual(paths[0].toString(), Uri.joinPath(Uri.file(__filename), 'kernels').toString());
        assert.strictEqual(paths[1].toString(), Uri.joinPath(windowsHomeDir, winJupyterPath).toString());
        assert.strictEqual(
            paths[2].toString(),
            Uri.file(path.join(allUserProfilePath, 'jupyter', 'kernels')).toString()
        );
    });
});
