// tslint:disable:no-console

import { spawnSync } from 'child_process';
import * as path from 'path';
import { downloadAndUnzipVSCode, resolveCliPathFromVSCodeExecutablePath, runTests } from 'vscode-test';
import { PythonExtension } from '../client/datascience/constants';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from './constants';
import { initializeLogger } from './testLogger';

initializeLogger();

process.env.IS_CI_SERVER_TEST_DEBUGGER = '';
process.env.VSC_JUPYTER_CI_TEST = '1';
const workspacePath = process.env.CODE_TESTS_WORKSPACE
    ? process.env.CODE_TESTS_WORKSPACE
    : path.join(__dirname, '..', '..', 'src', 'test');
const extensionDevelopmentPath = process.env.CODE_EXTENSIONS_PATH
    ? process.env.CODE_EXTENSIONS_PATH
    : EXTENSION_ROOT_DIR_FOR_TESTS;

function requiresPythonExtensionToBeInstalled() {
    if (process.env.VSC_JUPYTER_CI_TEST_DO_NOT_INSTALL_PYTHON_EXT) {
        return;
    }
    return process.env.TEST_FILES_SUFFIX === 'vscode.test' || process.env.TEST_FILES_SUFFIX === 'smoke.test';
}

const channel = (process.env.VSC_JUPYTER_CI_TEST_VSC_CHANNEL || '').toLowerCase().includes('insiders')
    ? 'insiders'
    : 'stable';

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

async function start() {
    console.log('*'.repeat(100));
    console.log('Start Standard tests');
    const vscodeExecutablePath = await downloadAndUnzipVSCode(channel);
    const baseLaunchArgs = requiresPythonExtensionToBeInstalled() ? [] : ['--disable-extensions'];
    await installPythonExtension(vscodeExecutablePath);
    await runTests({
        vscodeExecutablePath,
        extensionDevelopmentPath: extensionDevelopmentPath,
        extensionTestsPath: path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'out', 'test', 'index'),
        launchArgs: baseLaunchArgs
            .concat([workspacePath])
            .concat(channel === 'insiders' ? ['--enable-proposed-api'] : [])
            .concat(['--timeout', '5000']),
        version: channel,
        extensionTestsEnv: { ...process.env, DISABLE_INSIDERS_EXTENSION: '1' }
    });
}
start().catch((ex) => {
    console.error('End Standard tests (with errors)', ex);
    process.exit(1);
});
