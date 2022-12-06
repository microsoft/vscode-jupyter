// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawnSync } from 'child_process';
import * as path from '../platform/vscode-path/path';
import * as fs from 'fs-extra';
import { downloadAndUnzipVSCode, resolveCliPathFromVSCodeExecutablePath, runTests } from '@vscode/test-electron';
import { EXTENSION_ROOT_DIR_FOR_TESTS, IS_PERF_TEST, IS_SMOKE_TEST } from './constants.node';
import * as tmp from 'tmp';
import { PythonExtension, PylanceExtension, setTestExecution } from '../platform/common/constants';
import { DownloadPlatform } from '@vscode/test-electron/out/download';

process.env.IS_CI_SERVER_TEST_DEBUGGER = '';
process.env.VSC_JUPYTER_CI_TEST = '1';
const workspacePath = process.env.CODE_TESTS_WORKSPACE
    ? process.env.CODE_TESTS_WORKSPACE
    : path.join(__dirname, '..', '..', 'src', 'test');
const extensionDevelopmentPath = process.env.CODE_EXTENSIONS_PATH
    ? process.env.CODE_EXTENSIONS_PATH
    : EXTENSION_ROOT_DIR_FOR_TESTS;
const isRunningVSCodeTests = process.env.TEST_FILES_SUFFIX?.includes('vscode.test');
setTestExecution(true);

function requiresPythonExtensionToBeInstalled() {
    if (process.env.VSC_JUPYTER_CI_TEST_DO_NOT_INSTALL_PYTHON_EXT) {
        return;
    }
    return isRunningVSCodeTests || IS_SMOKE_TEST() || IS_PERF_TEST();
}

const channel = (process.env.VSC_JUPYTER_CI_TEST_VSC_CHANNEL || '').toLowerCase().includes('insiders')
    ? 'insiders'
    : 'stable';

function computePlatform() {
    switch (process.platform) {
        case 'darwin':
            return 'darwin';
        case 'win32':
            return process.arch === 'x32' || process.arch === 'ia32' ? 'win32-archive' : 'win32-x64-archive';
        default:
            return 'linux-x64';
    }
}
async function createTempDir() {
    return new Promise<string>((resolve, reject) => {
        tmp.dir((err, dir) => {
            if (err) {
                return reject(err);
            }
            resolve(dir);
        });
    });
}

/**
 * Smoke tests & tests running in VSCode require Python extension to be installed.
 */
async function installPythonExtension(vscodeExecutablePath: string, extensionsDir: string, platform: DownloadPlatform) {
    if (!requiresPythonExtensionToBeInstalled()) {
        console.info('Python Extension not required');
        return;
    }
    console.info(`Installing Python Extension ${PythonExtension} to ${extensionsDir}`);
    const cliPath = resolveCliPathFromVSCodeExecutablePath(vscodeExecutablePath, platform);
    spawnSync(
        cliPath,
        [
            '--install-extension',
            PythonExtension,
            '--pre-release',
            '--extensions-dir',
            extensionsDir,
            '--disable-telemetry'
        ],
        {
            encoding: 'utf-8',
            stdio: 'inherit'
        }
    );

    // Make sure pylance is there too as we'll use it for intellisense tests
    console.info(`Installing Pylance Extension to ${extensionsDir}`);
    spawnSync(
        cliPath,
        ['--install-extension', PylanceExtension, '--extensions-dir', extensionsDir, '--disable-telemetry'],
        {
            encoding: 'utf-8',
            stdio: 'inherit'
        }
    );
}

async function createSettings(): Promise<string> {
    // User data dir can be overridden with an environment variable.
    const userDataDirectory = process.env.VSC_JUPYTER_USER_DATA_DIR || (await createTempDir());
    process.env.VSC_JUPYTER_VSCODE_SETTINGS_DIR = userDataDirectory;
    const settingsFile = path.join(userDataDirectory, 'User', 'settings.json');
    const defaultSettings: Record<string, string | boolean | string[]> = {
        'python.insidersChannel': 'off',
        'jupyter.logging.level': 'verbose',
        'python.logging.level': 'debug',
        'files.autoSave': 'off',
        'python.experiments.enabled': true,
        'python.experiments.optOutFrom': [],
        'security.workspace.trust.enabled': false, // Disable trusted workspaces.
        // Disable the start page in VS Code tests, else this UI pops up and has potential to break tests.
        // For instance if the start page UI opens up, then active editor, active notebook and the like are empty.
        'python.showStartPage': false,
        // Disable the restart ask so that restart just happens
        'jupyter.askForKernelRestart': false,
        // To get widgets working.
        'jupyter.widgetScriptSources': ['jsdelivr.com', 'unpkg.com']
    };
    fs.ensureDirSync(path.dirname(settingsFile));
    fs.writeFileSync(settingsFile, JSON.stringify(defaultSettings, undefined, 4));
    return userDataDirectory;
}

async function getExtensionsDir(): Promise<string> {
    const name = 'vscode_jupyter_exts';
    const extDirPath = path.join(tmp.tmpdir, name);
    if (fs.existsSync(extDirPath)) {
        return extDirPath;
    }

    return new Promise<string>((resolve, reject) => {
        tmp.dir({ name, keep: true }, (err, dir) => {
            if (err) {
                return reject(err);
            }
            resolve(dir);
        });
    });
}

async function start() {
    console.log('*'.repeat(100));
    console.log('Start Standard tests');
    const platform = computePlatform();
    const vscodeExecutablePath = await downloadAndUnzipVSCode(channel, platform);
    const baseLaunchArgs = requiresPythonExtensionToBeInstalled() ? [] : ['--disable-extensions'];
    const userDataDirectory = await createSettings();
    const extensionsDir = await getExtensionsDir();
    await installPythonExtension(vscodeExecutablePath, extensionsDir, platform);
    await runTests({
        vscodeExecutablePath,
        extensionDevelopmentPath: extensionDevelopmentPath,
        extensionTestsPath: path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'out', 'test', 'index.node.js'),
        launchArgs: baseLaunchArgs
            .concat([workspacePath])
            .concat(['--skip-welcome'])
            .concat(['--skip-release-notes'])
            .concat(['--enable-proposed-api'])
            .concat(['--timeout', '5000'])
            .concat(['--extensions-dir', extensionsDir])
            .concat(['--user-data-dir', userDataDirectory]),
        // .concat(['--verbose']), // Too much logging from VS Code, enable this to see what's going on in VSC.
        version: channel,
        extensionTestsEnv: { ...process.env, DISABLE_INSIDERS_EXTENSION: '1' }
    });
}
start().catch((ex) => {
    console.error('End Standard tests (with errors)', ex);
    process.exit(1);
});
