// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawnSync } from 'child_process';
import * as path from '../platform/vscode-path/path';
import * as fs from 'fs-extra';
import { downloadAndUnzipVSCode, resolveCliPathFromVSCodeExecutablePath, runTests } from '@vscode/test-electron';
import { EXTENSION_ROOT_DIR_FOR_TESTS, IS_PERF_TEST, IS_SMOKE_TEST } from './constants.node';
import * as tmp from 'tmp';
import {
    PythonExtension,
    PylanceExtension,
    setTestExecution,
    RendererExtension,
    isCI
} from '../platform/common/constants';
import { DownloadPlatform } from '@vscode/test-electron/out/download';
import { arch } from 'os';

// Support for passing grep (specially for models or Copilot Coding Agent)
// Local Copilot or Copilot Coding Agent can use `--grep=XYZ` or `--grep XYZ`
if (process.argv.some((arg) => arg.startsWith('--grep='))) {
    process.env.VSC_JUPYTER_CI_TEST_GREP =
        process.argv
            .filter((arg) => arg.startsWith('--grep='))
            .map((arg) => arg.split('=')[1])
            .pop() ||
        process.env.VSC_JUPYTER_CI_TEST_GREP ||
        '';
} else if (process.argv.some((arg) => arg === '--grep')) {
    const indexOfGrep = process.argv.indexOf('--grep');
    if (indexOfGrep !== -1 && process.argv.length > indexOfGrep + 1) {
        process.env.VSC_JUPYTER_CI_TEST_GREP =
            process.argv[indexOfGrep + 1] || process.env.VSC_JUPYTER_CI_TEST_GREP || '';
    }
}

process.env.IS_CI_SERVER_TEST_DEBUGGER = '';
process.env.VSC_JUPYTER_CI_TEST = '1';
const workspacePath = process.env.CODE_TESTS_WORKSPACE
    ? process.env.CODE_TESTS_WORKSPACE
    : path.join(__dirname, '..', '..', 'src', 'test');
const extensionDevelopmentPathForTestsWithJupyter = process.env.CODE_EXTENSIONS_PATH
    ? process.env.CODE_EXTENSIONS_PATH
    : EXTENSION_ROOT_DIR_FOR_TESTS;
const extensionDevelopmentPathForPerfTestsWithoutJupyter = path.join(
    extensionDevelopmentPathForTestsWithJupyter,
    'src',
    'test',
    'vscode-notebook-perf'
);
const extensionDevelopmentPath = isNotebookPerfTestWithoutJupyter()
    ? extensionDevelopmentPathForPerfTestsWithoutJupyter
    : extensionDevelopmentPathForTestsWithJupyter;

const isRunningVSCodeTests = process.env.TEST_FILES_SUFFIX?.includes('vscode.test');
setTestExecution(true);

function requiresPythonExtensionToBeInstalled() {
    if (
        process.env.VSC_JUPYTER_CI_TEST_DO_NOT_INSTALL_PYTHON_EXT &&
        process.env.VSC_JUPYTER_CI_TEST_DO_NOT_INSTALL_PYTHON_EXT !== 'false'
    ) {
        return;
    }
    return isRunningVSCodeTests || IS_SMOKE_TEST() || IS_PERF_TEST();
}

function isNotebookPerfTestWithoutJupyter() {
    return process.env.VSC_JUPYTER_CI_TEST_GREP === '@notebookPerformance';
}

const channel = (process.env.VSC_JUPYTER_CI_TEST_VSC_CHANNEL || '').toLowerCase().includes('stable')
    ? 'stable'
    : 'insiders';

function computePlatform() {
    switch (process.platform) {
        case 'darwin':
            return arch() === 'arm64' ? 'darwin-arm64' : 'darwin';
        case 'win32':
            return process.arch === 'ia32' ? 'win32-archive' : 'win32-x64-archive';
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
    if (!requiresPythonExtensionToBeInstalled() || isNotebookPerfTestWithoutJupyter()) {
        console.info('Python Extension not required');
        return;
    }
    const cliPath = resolveCliPathFromVSCodeExecutablePath(vscodeExecutablePath, platform);
    await installExtension(PythonExtension, cliPath, extensionsDir, ['--pre-release']);

    // Make sure pylance is there too as we'll use it for intellisense tests
    await installExtension(PylanceExtension, cliPath, extensionsDir);

    // Make sure renderers is there too as we'll use it for widget tests
    await installExtension(RendererExtension, cliPath, extensionsDir);
}

// Make sure renderers is there too as we'll use it for widget tests
async function installExtension(extension: string, cliPath: string, extensionsDir: string, args: string[] = []) {
    args = ['--install-extension', extension, ...args, '--extensions-dir', extensionsDir, '--disable-telemetry'];
    const output =
        process.platform === 'win32'
            ? spawnSync(cliPath, args, {
                  encoding: 'utf-8',
                  stdio: 'inherit',
                  shell: true // Without this, node 20 would fail to install the extensions on Windows. See https://github.com/nodejs/node/issues/52554
              })
            : spawnSync(cliPath, args, {
                  encoding: 'utf-8',
                  stdio: 'inherit'
              });

    if (output.error) {
        throw output.error;
    }
    if (output.stderr) {
        console.error(`Error installing ${extension} Extension to ${extensionsDir}`);
        console.error(output.stderr);
    }
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
        'jupyter.widgetScriptSources': ['jsdelivr.com', 'unpkg.com'],
        'notebook.stickyScroll.enabled': true, // Required for perf tests
        'notebook.outline.showCodeCells': true // Required for perf tests
    };

    if (IS_SMOKE_TEST()) {
        defaultSettings['python.languageServer'] = 'None';
    }
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
    const platform = computePlatform();
    const vscodeExecutablePath = await downloadAndUnzipVSCode(channel, platform);
    const baseLaunchArgs = requiresPythonExtensionToBeInstalled() ? [] : ['--disable-extensions'];
    const userDataDirectory = await createSettings();
    const extensionsDir = await getExtensionsDir();
    console.error(`Using extensions development path: ${extensionDevelopmentPath}`);
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
            .concat(['--disable-extension', 'ms-python.isort']) // We don't need this, also has a lot of errors on CI and floods CI logs unnecessarily.
            .concat(IS_SMOKE_TEST() ? ['--disable-extension', 'ms-python.vscode-pylance'] : []) // For some reason pylance crashes and takes down the entire test run. See https://github.com/microsoft/vscode-jupyter/issues/13200
            .concat(['--extensions-dir', extensionsDir])
            .concat(['--user-data-dir', userDataDirectory]),
        // .concat(['--verbose']), // Too much logging from VS Code, enable this to see what's going on in VSC.
        version: channel,
        extensionTestsEnv: { ...process.env, DISABLE_INSIDERS_EXTENSION: '1' }
    });
}

const webTestSummaryJsonFile = IS_SMOKE_TEST()
    ? path.join(__dirname, '..', '..', 'logs', 'testresults.json')
    : path.join(__dirname, '..', '..', 'temp', 'ext', 'smokeTestExtensionsFolder', 'logs', 'testresults.json');
if (isCI && fs.existsSync(webTestSummaryJsonFile)) {
    // On CI sometimes VS Code crashes or there are network issues and tests do not even start
    // We will create a simple file to indicate whether tests started
    // if this file isn't created, then we know its an infrastructure issue and we can retry tests once again
    fs.unlinkSync(webTestSummaryJsonFile);
}
start()
    .catch((ex) => {
        console.error('End Standard tests (with errors)', ex);
        // If we failed and could not start the tests, then try again
        // Could be some flaky network issue or the like.
        if (isCI && !fs.existsSync(webTestSummaryJsonFile)) {
            return start();
        }
        process.exit(1);
    })
    .catch((ex) => {
        console.error('End Standard tests (with errors)', ex);
        process.exit(1);
    })
    .finally(() => {
        if (process.env.VSC_JUPYTER_FORCE_LOGGING) {
            console.log(
                `Log file ${webTestSummaryJsonFile} ${
                    fs.existsSync(webTestSummaryJsonFile) ? 'has' : 'has not'
                } been created`
            );
        }
    });
