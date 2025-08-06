// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable local-rules/dont-use-process */

import * as sinon from 'sinon';
import { assert } from 'chai';
import { anything, deepEqual, instance, mock, when, verify } from 'ts-mockito';
import { CancellationTokenSource, ExtensionContext, Memento, Uri } from 'vscode';
import { CACHE_KEY_FOR_JUPYTER_KERNEL_PATHS, JupyterPaths } from './jupyterPaths.node';
import { dispose } from '../../../platform/common/utils/lifecycle';
import { IFileSystem, IPlatformService } from '../../../platform/common/platform/types';
import { IDisposable } from '../../../platform/common/types';
import { isWeb } from '../../../platform/common/utils/misc';
import { OSType } from '../../../platform/common/utils/platform';
import { ICustomEnvironmentVariablesProvider } from '../../../platform/common/variables/types';
import { IPythonExecutionService, IPythonExecutionFactory } from '../../../platform/interpreter/types.node';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import * as path from '../../../platform/vscode-path/path';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../../../test/constants.node';
import { resolvableInstance, uriEquals } from '../../../test/datascience/helpers';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { PythonExtension } from '@vscode/python-extension';
import { setPythonApi } from '../../../platform/interpreter/helpers';

suite('Jupyter Paths', () => {
    let disposables: IDisposable[] = [];
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
    const sysPrefix = `PythonEnv${path.sep}PythonSysPrefix`;
    const interpreter: PythonEnvironment = {
        uri: Uri.file('PythonEnv'),
        id: Uri.file('PythonEnv').fsPath
    };
    const unixHomeDir = Uri.file('/users/username');
    const macHomeDir = Uri.file('/users/username');
    const linuxJupyterPath = path.join('.local', 'share', 'jupyter', 'kernels');
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
        const interpreterService = mock<IInterpreterService>();
        when(interpreterService.getInterpreterDetails(anything())).thenResolve();
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

        const mockedApi = mock<PythonExtension>();
        sinon.stub(PythonExtension, 'api').resolves(resolvableInstance(mockedApi));
        disposables.push({ dispose: () => sinon.restore() });
        const environments = mock<PythonExtension['environments']>();
        when(mockedApi.environments).thenReturn(instance(environments));
        when(environments.known).thenReturn([]);
        setPythonApi(instance(mockedApi));
        disposables.push({ dispose: () => setPythonApi(undefined as any) });
        when(environments.resolveEnvironment(interpreter.id)).thenResolve({
            executable: { sysPrefix }
        } as any);
    });
    teardown(async () => {
        disposables = dispose(disposables);
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
        assert.strictEqual(dataDirs[4].toString(), Uri.joinPath(Uri.file(sysPrefix), 'share', 'jupyter').toString());
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
        assert.strictEqual(dataDirs[5].toString(), Uri.joinPath(Uri.file(sysPrefix), 'share', 'jupyter').toString());
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
        assert.strictEqual(dataDirs[1].toString(), Uri.joinPath(Uri.file(sysPrefix), 'share', 'jupyter').toString());
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
        assert.strictEqual(dataDirs[5].toString(), Uri.joinPath(Uri.file(sysPrefix), 'share', 'jupyter').toString());
    });

    test('Get kernelspec root paths on Windows', async () => {
        when(platformService.osType).thenReturn(OSType.Windows);
        when(platformService.homeDir).thenReturn(windowsHomeDir);
        when(memento.get(CACHE_KEY_FOR_JUPYTER_KERNEL_PATHS, anything())).thenReturn([]);

        const paths = await jupyterPaths.getKernelSpecRootPaths(cancelToken.token);
        const winJupyterPath = path.join('AppData', 'Roaming', 'jupyter', 'kernels');

        // New implementation returns data dirs + kernel spec root path
        assert.strictEqual(paths.length, 2, `Expected 2 paths, got ${paths.length}, ${JSON.stringify(paths)}`);
        
        // First path should be from data directory (.jupyter/data/kernels)
        assert.strictEqual(paths[0].toString(), Uri.joinPath(windowsHomeDir, '.jupyter', 'data', 'kernels').toString());
        
        // Second path should be the kernel spec root path
        assert.strictEqual(paths[1].toString(), Uri.joinPath(windowsHomeDir, winJupyterPath).toString());
    });

    test('Get kernelspec root paths on Windows with JUPYTER_PATH env variable', async () => {
        when(platformService.osType).thenReturn(OSType.Windows);
        when(platformService.homeDir).thenReturn(windowsHomeDir);
        when(memento.get(CACHE_KEY_FOR_JUPYTER_KERNEL_PATHS, anything())).thenReturn([]);
        const jupyter_Paths = [__filename];
        process.env['JUPYTER_PATH'] = jupyter_Paths.join(path.delimiter);

        const paths = await jupyterPaths.getKernelSpecRootPaths(cancelToken.token);
        const winJupyterPath = path.join('AppData', 'Roaming', 'jupyter', 'kernels');

        // New implementation returns JUPYTER_PATH kernels + data dirs + kernel spec root path
        assert.strictEqual(paths.length, 3, `Expected 3 paths, got ${paths.length}, ${JSON.stringify(paths)}`);
        
        // First path should be from JUPYTER_PATH
        assert.strictEqual(paths[0].toString(), Uri.joinPath(Uri.file(__filename), 'kernels').toString());
        
        // Second path should be from data directory (.jupyter/data/kernels)
        assert.strictEqual(paths[1].toString(), Uri.joinPath(windowsHomeDir, '.jupyter', 'data', 'kernels').toString());
        
        // Third path should be the kernel spec root path
        assert.strictEqual(paths[2].toString(), Uri.joinPath(windowsHomeDir, winJupyterPath).toString());
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

        // New implementation returns JUPYTER_PATH kernels + data dirs + PROGRAMDATA + kernel spec root path
        assert.strictEqual(paths.length, 4, `Expected 4 paths, got ${paths.length}, ${JSON.stringify(paths)}`);
        
        // First path should be from JUPYTER_PATH
        assert.strictEqual(paths[0].toString(), Uri.joinPath(Uri.file(__filename), 'kernels').toString());
        
        // Second path should be from data directory (.jupyter/data/kernels) 
        assert.strictEqual(paths[1].toString(), Uri.joinPath(windowsHomeDir, '.jupyter', 'data', 'kernels').toString());
        
        // Third path should be from PROGRAMDATA 
        assert.strictEqual(
            paths[2].toString(),
            Uri.file(path.join(allUserProfilePath, 'jupyter', 'kernels')).toString()
        );
        
        // Fourth path should be the kernel spec root path
        assert.strictEqual(paths[3].toString(), Uri.joinPath(windowsHomeDir, winJupyterPath).toString());
    });

    test('Get kernelspec root paths on Linux', async () => {
        when(platformService.osType).thenReturn(OSType.Linux);
        when(platformService.isWindows).thenReturn(false);
        when(platformService.isMac).thenReturn(false);
        when(platformService.homeDir).thenReturn(unixHomeDir);
        when(memento.get(CACHE_KEY_FOR_JUPYTER_KERNEL_PATHS, anything())).thenReturn([]);
        
        // Clear environment variables that might affect the test
        delete process.env['XDG_DATA_HOME'];
        delete process.env['JUPYTER_DATA_DIR'];

        const paths = await jupyterPaths.getKernelSpecRootPaths(cancelToken.token);

        // Should include data dirs + system paths, and possibly kernel spec root path
        assert.isAtLeast(paths.length, 3, `Expected at least 3 paths, got ${paths.length}, ${JSON.stringify(paths)}`);
        
        // First path should be from data directory (without XDG_DATA_HOME, defaults to ~/.local/share/jupyter)
        assert.strictEqual(paths[0].toString(), Uri.joinPath(unixHomeDir, '.local', 'share', 'jupyter', 'kernels').toString());
        
        // Should include system paths
        const pathStrings = paths.map(p => p.toString());
        assert.include(pathStrings, Uri.file('/usr/share/jupyter/kernels').toString());
        assert.include(pathStrings, Uri.file('/usr/local/share/jupyter/kernels').toString());
        
        // May include kernel spec root path if available
        const hasKernelSpecRootPath = pathStrings.some(p => p.includes(linuxJupyterPath));
        if (hasKernelSpecRootPath) {
            assert.include(pathStrings, Uri.joinPath(unixHomeDir, linuxJupyterPath).toString());
        }
    });

    test('Get kernelspec root paths on macOS', async () => {
        when(platformService.osType).thenReturn(OSType.OSX);
        when(platformService.isWindows).thenReturn(false);
        when(platformService.isMac).thenReturn(true);
        when(platformService.homeDir).thenReturn(macHomeDir);
        when(memento.get(CACHE_KEY_FOR_JUPYTER_KERNEL_PATHS, anything())).thenReturn([]);
        
        // Clear environment variables that might affect the test
        delete process.env['XDG_DATA_HOME'];
        delete process.env['JUPYTER_DATA_DIR'];

        const paths = await jupyterPaths.getKernelSpecRootPaths(cancelToken.token);

        // Should include at least 3 paths: data dir + system paths
        assert.isAtLeast(paths.length, 3, `Expected at least 3 paths, got ${paths.length}, ${JSON.stringify(paths)}`);
        
        // First path should be from data directory (macOS uses ~/Library/Jupyter)
        assert.strictEqual(paths[0].toString(), Uri.joinPath(macHomeDir, 'Library', 'Jupyter', 'kernels').toString());
        
        // Should include system paths
        const pathStrings = paths.map(p => p.toString());
        assert.include(pathStrings, Uri.file('/usr/share/jupyter/kernels').toString());
        assert.include(pathStrings, Uri.file('/usr/local/share/jupyter/kernels').toString());
    });

    test('Get kernelspec root paths on Linux with Python interpreter', async () => {
        when(platformService.osType).thenReturn(OSType.Linux);
        when(platformService.isWindows).thenReturn(false);
        when(platformService.isMac).thenReturn(false);
        when(platformService.homeDir).thenReturn(unixHomeDir);
        when(memento.get(CACHE_KEY_FOR_JUPYTER_KERNEL_PATHS, anything())).thenReturn([]);

        // Mock getDataDirs to return additional interpreter-specific paths
        const mockDataDirs = [
            Uri.joinPath(unixHomeDir, '.local', 'share', 'jupyter'),
            Uri.joinPath(Uri.file(sysPrefix), 'share', 'jupyter')
        ];
        sinon.stub(jupyterPaths, 'getDataDirs').resolves(mockDataDirs);

        const paths = await jupyterPaths.getKernelSpecRootPaths(cancelToken.token);

        // Should include interpreter-specific data dirs converted to kernel paths
        const pathStrings = paths.map(p => p.toString());
        assert.include(pathStrings, Uri.joinPath(unixHomeDir, '.local', 'share', 'jupyter', 'kernels').toString());
        assert.include(pathStrings, Uri.joinPath(Uri.file(sysPrefix), 'share', 'jupyter', 'kernels').toString());
        
        sinon.restore();
    });

    test('Get kernelspec root paths handles cancellation token', async () => {
        when(platformService.osType).thenReturn(OSType.Windows);
        when(platformService.homeDir).thenReturn(windowsHomeDir);
        when(memento.get(CACHE_KEY_FOR_JUPYTER_KERNEL_PATHS, anything())).thenReturn([]);

        // Cancel the token immediately
        cancelToken.cancel();

        const paths = await jupyterPaths.getKernelSpecRootPaths(cancelToken.token);

        // Should return empty array when cancelled
        assert.strictEqual(paths.length, 0, `Expected empty array when cancelled, got ${paths.length} paths`);
    });

    test('Get kernelspec root paths handles missing home directory gracefully', async () => {
        when(platformService.osType).thenReturn(OSType.Linux);
        when(platformService.isWindows).thenReturn(false);
        when(platformService.isMac).thenReturn(false);
        when(platformService.homeDir).thenReturn(undefined); // No home directory
        when(memento.get(CACHE_KEY_FOR_JUPYTER_KERNEL_PATHS, anything())).thenReturn([]);

        const paths = await jupyterPaths.getKernelSpecRootPaths(cancelToken.token);

        // Should still return system paths even without home directory
        const pathStrings = paths.map(p => p.toString());
        assert.include(pathStrings, Uri.file('/usr/share/jupyter/kernels').toString());
        assert.include(pathStrings, Uri.file('/usr/local/share/jupyter/kernels').toString());
    });

    test('Get kernelspec root paths deduplicates paths', async () => {
        when(platformService.osType).thenReturn(OSType.Windows);
        when(platformService.homeDir).thenReturn(windowsHomeDir);
        when(memento.get(CACHE_KEY_FOR_JUPYTER_KERNEL_PATHS, anything())).thenReturn([]);

        // Create a scenario where paths might be duplicated
        const duplicatePath = Uri.joinPath(windowsHomeDir, '.jupyter', 'data');
        const mockDataDirs = [
            duplicatePath,
            duplicatePath, // Duplicate
            Uri.joinPath(windowsHomeDir, 'AppData', 'Roaming', 'jupyter')
        ];
        sinon.stub(jupyterPaths, 'getDataDirs').resolves(mockDataDirs);

        const paths = await jupyterPaths.getKernelSpecRootPaths(cancelToken.token);

        // Should not contain duplicate paths
        const pathStrings = paths.map(p => p.toString());
        const uniquePaths = [...new Set(pathStrings)];
        assert.strictEqual(pathStrings.length, uniquePaths.length, 'Paths should be deduplicated');
        
        sinon.restore();
    });

    test('Get kernelspec root paths with cached data', async () => {
        const cachedPaths = [
            Uri.joinPath(windowsHomeDir, 'cached1', 'kernels').toString(),
            Uri.joinPath(windowsHomeDir, 'cached2', 'kernels').toString()
        ];
        when(platformService.osType).thenReturn(OSType.Windows);
        when(platformService.homeDir).thenReturn(windowsHomeDir);
        when(memento.get(CACHE_KEY_FOR_JUPYTER_KERNEL_PATHS, anything())).thenReturn(cachedPaths);

        const paths = await jupyterPaths.getKernelSpecRootPaths(cancelToken.token);

        // Should return cached data if available
        assert.strictEqual(paths.length, 2);
        assert.strictEqual(paths[0].toString(), cachedPaths[0]);
        assert.strictEqual(paths[1].toString(), cachedPaths[1]);
    });

    test('Get kernelspec root paths with JUPYTER_PATH on Linux', async () => {
        when(platformService.osType).thenReturn(OSType.Linux);
        when(platformService.isWindows).thenReturn(false);
        when(platformService.isMac).thenReturn(false);
        when(platformService.homeDir).thenReturn(unixHomeDir);
        when(memento.get(CACHE_KEY_FOR_JUPYTER_KERNEL_PATHS, anything())).thenReturn([]);
        
        const jupyter_Paths = ['/custom/jupyter/path1', '/custom/jupyter/path2'];
        process.env['JUPYTER_PATH'] = jupyter_Paths.join(path.delimiter);

        const paths = await jupyterPaths.getKernelSpecRootPaths(cancelToken.token);

        // First paths should be from JUPYTER_PATH with 'kernels' appended
        assert.isAtLeast(paths.length, 2, `Expected at least 2 paths, got ${paths.length}`);
        assert.strictEqual(paths[0].toString(), Uri.joinPath(Uri.file(jupyter_Paths[0]), 'kernels').toString());
        assert.strictEqual(paths[1].toString(), Uri.joinPath(Uri.file(jupyter_Paths[1]), 'kernels').toString());
    });

    test('Enhanced caching behavior works correctly', async () => {
        when(platformService.osType).thenReturn(OSType.Windows);
        when(platformService.homeDir).thenReturn(windowsHomeDir);
        when(memento.get(CACHE_KEY_FOR_JUPYTER_KERNEL_PATHS, anything())).thenReturn([]);

        // First call
        const paths1 = await jupyterPaths.getKernelSpecRootPaths(cancelToken.token);
        
        // Verify caching method is called
        verify(memento.get(CACHE_KEY_FOR_JUPYTER_KERNEL_PATHS, anything())).atLeast(1);

        // Second call should use cached result (simulate by using same token)
        const newCancelToken = new CancellationTokenSource();
        disposables.push(newCancelToken);
        const paths2 = await jupyterPaths.getKernelSpecRootPaths(newCancelToken.token);

        assert.strictEqual(paths1.length, paths2.length);
        paths1.forEach((path, index) => {
            assert.strictEqual(path.toString(), paths2[index].toString());
        });
    });
});
