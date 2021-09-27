/* eslint-disable no-console */

import { spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs-extra';
import { downloadAndUnzipVSCode, resolveCliPathFromVSCodeExecutablePath, runTests } from '@vscode/test-electron';
import { PythonExtension, PylanceExtension } from '../client/datascience/constants';
import { EXTENSION_ROOT_DIR_FOR_TESTS, IS_REMOTE_NATIVE_TEST } from './constants';
import { initializeLogger } from './testLogger';
import * as tmp from 'tmp';

initializeLogger();

process.env.IS_CI_SERVER_TEST_DEBUGGER = '';
process.env.VSC_JUPYTER_CI_TEST = '1';
const workspacePath = process.env.CODE_TESTS_WORKSPACE
    ? process.env.CODE_TESTS_WORKSPACE
    : path.join(__dirname, '..', '..', 'src', 'test');
const extensionDevelopmentPath = process.env.CODE_EXTENSIONS_PATH
    ? process.env.CODE_EXTENSIONS_PATH
    : EXTENSION_ROOT_DIR_FOR_TESTS;
const isRunningSmokeTests = process.env.TEST_FILES_SUFFIX === 'smoke.test';
const isRunningVSCodeTests = process.env.TEST_FILES_SUFFIX === 'vscode.test';

function requiresPythonExtensionToBeInstalled() {
    if (process.env.VSC_JUPYTER_CI_TEST_DO_NOT_INSTALL_PYTHON_EXT) {
        return;
    }
    return isRunningVSCodeTests || isRunningSmokeTests;
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
async function installPythonExtension(vscodeExecutablePath: string) {
    // Pick python extension to use based on environment variable. Insiders can be flakey so
    // have the capability to turn it off/on.
    const pythonVSIX =
        process.env.VSC_JUPTYER_PYTHON_EXTENSION_VERSION === 'insiders'
            ? process.env.VSIX_NAME_PYTHON
            : PythonExtension;
    if (!requiresPythonExtensionToBeInstalled() || !pythonVSIX) {
        console.info('Python Extension not required');
        return;
    }
    console.info(`Installing Python Extension ${pythonVSIX}`);
    const cliPath = resolveCliPathFromVSCodeExecutablePath(vscodeExecutablePath);
    spawnSync(cliPath, ['--install-extension', pythonVSIX], {
        encoding: 'utf-8',
        stdio: 'inherit'
    });

    // Make sure pylance is there too as we'll use it for intellisense tests
    console.info('Installing Pylance Extension');
    spawnSync(cliPath, ['--install-extension', PylanceExtension], {
        encoding: 'utf-8',
        stdio: 'inherit'
    });
}

async function createSettings(): Promise<string> {
    // User data dir can be overridden with an environment variable.
    const userDataDirectory = process.env.VSC_JUPYTER_USER_DATA_DIR || (await createTempDir());
    process.env.VSC_JUPYTER_VSCODE_SETTINGS_DIR = userDataDirectory;
    const settingsFile = path.join(userDataDirectory, 'User', 'settings.json');
    const defaultSettings: Record<string, string | boolean | string[]> = {
        'python.insidersChannel': 'off',
        'jupyter.logging.level': 'debug',
        'python.logging.level': 'debug',
        'python.experiments.enabled': true,
        'python.experiments.optOutFrom': [],
        'security.workspace.trust.enabled': false, // Disable trusted workspaces.
        // Disable the start page in VS Code tests, else this UI pops up and has potential to break tests.
        // For instance if the start page UI opens up, then active editor, active notebook and the like are empty.
        'python.showStartPage': false
    };

    if (channel !== 'insiders') {
        // When in Stable, ensure we don't end up using Native Notebooks in CI tests.
        // I.e. ensure we have predictable state/experiments.
        defaultSettings['jupyter.experiments.optOutFrom'] = ['NativeNotebookEditor'];
    }
    if (IS_REMOTE_NATIVE_TEST) {
        // Make this a remote instance.
        defaultSettings['jupyter.jupyterServerType'] = 'remote';
    }
    fs.ensureDirSync(path.dirname(settingsFile));
    fs.writeFileSync(settingsFile, JSON.stringify(defaultSettings, undefined, 4));
    return userDataDirectory;
}
async function start() {
    console.log('*'.repeat(100));
    console.log('Start Standard tests');
    const platform = computePlatform();
    const vscodeExecutablePath = await downloadAndUnzipVSCode(channel, platform);
    const baseLaunchArgs = requiresPythonExtensionToBeInstalled() ? [] : ['--disable-extensions'];
    const userDataDirectory = await createSettings();
    await installPythonExtension(vscodeExecutablePath);
    await runTests({
        vscodeExecutablePath,
        extensionDevelopmentPath: extensionDevelopmentPath,
        extensionTestsPath: path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'out', 'test', 'index'),
        launchArgs: baseLaunchArgs
            .concat([workspacePath])
            .concat(['--skip-welcome'])
            .concat(['--skip-release-notes'])
            .concat(['--enable-proposed-api'])
            .concat(['--timeout', '5000'])
            .concat(['--user-data-dir', userDataDirectory])
            .concat(['--verbose']),
        version: channel,
        extensionTestsEnv: { ...process.env, DISABLE_INSIDERS_EXTENSION: '1' }
    });
}
start().catch((ex) => {
    console.error('End Standard tests (with errors)', ex);
    process.exit(1);
});
