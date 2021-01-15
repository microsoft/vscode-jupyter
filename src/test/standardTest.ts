/* eslint-disable no-console */

import { spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs-extra';
import { downloadAndUnzipVSCode, resolveCliPathFromVSCodeExecutablePath, runTests } from 'vscode-test';
import { PythonExtension } from '../client/datascience/constants';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from './constants';
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
    if (!requiresPythonExtensionToBeInstalled()) {
        console.info('Python Extension not required');
        return;
    }
    console.info('Installing Python Extension');
    const cliPath = resolveCliPathFromVSCodeExecutablePath(vscodeExecutablePath);
    spawnSync(cliPath, ['--install-extension', PythonExtension], {
        encoding: 'utf-8',
        stdio: 'inherit'
    });
}

async function createSettings(): Promise<string> {
    const userDataDirectory = await createTempDir();
    process.env.VSC_JUPYTER_VSCODE_SETTINGS_DIR = userDataDirectory;
    const settingsFile = path.join(userDataDirectory, 'User', 'settings.json');
    const defaultSettings: Record<string, string | boolean> = {
        'python.insidersChannel': 'off',
        'jupyter.logging.level': 'debug',
        'python.logging.level': 'debug',
        // Disable the start page in VS Code tests, else this UI pops up and has potential to break tests.
        // For instance if the start page UI opens up, then active editor, active notebook and the like are empty.
        'python.showStartPage': false
    };

    // if smoke tests, then trust everything.
    if (isRunningSmokeTests) {
        defaultSettings['jupyter.alwaysTrustNotebooks'] = true;
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
            .concat(channel === 'insiders' ? ['--enable-proposed-api'] : [])
            .concat(['--timeout', '5000'])
            .concat(['--user-data-dir', userDataDirectory]),
        version: channel,
        extensionTestsEnv: { ...process.env, DISABLE_INSIDERS_EXTENSION: '1' }
    });
}
start().catch((ex) => {
    console.error('End Standard tests (with errors)', ex);
    process.exit(1);
});
