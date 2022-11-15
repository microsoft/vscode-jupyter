// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

/* eslint-disable no-console, @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

import assert from 'assert';
import * as fs from 'fs-extra';
import * as path from '../platform/vscode-path/path';
import * as tmp from 'tmp';
import { coerce, SemVer } from 'semver';
import { IProcessService } from '../platform/common/process/types.node';
import {
    EXTENSION_ROOT_DIR_FOR_TESTS,
    IS_MULTI_ROOT_TEST,
    IS_PERF_TEST,
    IS_REMOTE_NATIVE_TEST,
    IS_SMOKE_TEST
} from './constants.node';
import { noop, sleep } from './core';
import { isCI } from '../platform/common/constants';
import { IWorkspaceService } from '../platform/common/application/types';
import { generateScreenShotFileName, initializeCommonApi } from './common';
import { IDisposable } from '../platform/common/types';
import { swallowExceptions } from '../platform/common/utils/misc';
import { JupyterServer } from './datascience/jupyterServer.node';
import type { ConfigurationTarget, NotebookDocument, TextDocument, Uri } from 'vscode';

export { createEventHandler } from './common';

const StreamZip = require('node-stream-zip');

export { sleep } from './core';

export * from './common';

/* eslint-disable no-invalid-this, @typescript-eslint/no-explicit-any */

const fileInNonRootWorkspace = path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'test', 'pythonFiles', 'dummy.py');
export const rootWorkspaceUri = getWorkspaceRoot();

export const PYTHON_PATH = getPythonPath();
// Useful to see on CI (when working with conda & non-conda, virtual envs & the like).
console.log(`Python used in tests is ${PYTHON_PATH}`);

export type PythonSettingKeys =
    | 'workspaceSymbols.enabled'
    | 'defaultInterpreterPath'
    | 'languageServer'
    | 'linting.lintOnSave'
    | 'linting.enabled'
    | 'linting.pylintEnabled'
    | 'linting.flake8Enabled'
    | 'linting.pycodestyleEnabled'
    | 'linting.pylamaEnabled'
    | 'linting.prospectorEnabled'
    | 'linting.pydocstyleEnabled'
    | 'linting.mypyEnabled'
    | 'linting.banditEnabled'
    | 'testing.nosetestArgs'
    | 'testing.pytestArgs'
    | 'testing.unittestArgs'
    | 'formatting.provider'
    | 'sortImports.args'
    | 'testing.nosetestsEnabled'
    | 'testing.pytestEnabled'
    | 'testing.unittestEnabled'
    | 'envFile'
    | 'linting.ignorePatterns'
    | 'terminal.activateEnvironment';

export async function setPythonPathInWorkspaceRoot(pythonPath: string) {
    const vscode = require('vscode') as typeof import('vscode');
    return retryAsync(setPythonPathInWorkspace)(undefined, vscode.ConfigurationTarget.Workspace, pythonPath);
}

export async function setAutoSaveDelayInWorkspaceRoot(delayinMS: number) {
    const vscode = require('vscode') as typeof import('vscode');
    return retryAsync(setAutoSaveDelay)(undefined, vscode.ConfigurationTarget.Workspace, delayinMS);
}

function getWorkspaceRoot() {
    if (IS_SMOKE_TEST() || IS_PERF_TEST()) {
        return;
    }
    const vscode = require('vscode') as typeof import('vscode');
    if (!Array.isArray(vscode.workspace.workspaceFolders) || vscode.workspace.workspaceFolders.length === 0) {
        return vscode.Uri.file(path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'test'));
    }
    if (vscode.workspace.workspaceFolders.length === 1) {
        return vscode.workspace.workspaceFolders[0].uri;
    }
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(fileInNonRootWorkspace));
    return workspaceFolder ? workspaceFolder.uri : vscode.workspace.workspaceFolders[0].uri;
}

export async function getExtensionSettings(resource: Uri | undefined, workspaceService: IWorkspaceService) {
    const pythonSettings =
        require('../platform/common/configSettings') as typeof import('../platform/common/configSettings');
    const systemVariables = await import('../platform/common/variables/systemVariables.node');
    return pythonSettings.JupyterSettings.getInstance(
        resource,
        systemVariables.SystemVariables,
        'node',
        workspaceService
    );
}
export function retryAsync(this: any, wrapped: Function, retryCount: number = 2) {
    return async (...args: any[]) => {
        return new Promise((resolve, reject) => {
            const reasons: any[] = [];

            const makeCall = () => {
                wrapped.call(this as Function, ...args).then(resolve, (reason: any) => {
                    reasons.push(reason);
                    if (reasons.length >= retryCount) {
                        reject(reasons);
                    } else {
                        // If failed once, lets wait for some time before trying again.
                        setTimeout(makeCall, 500);
                    }
                });
            };

            makeCall();
        });
    };
}

async function setAutoSaveDelay(resource: string | Uri | undefined, config: ConfigurationTarget, delayinMS: number) {
    const vscode = require('vscode') as typeof import('vscode');
    if (config === vscode.ConfigurationTarget.WorkspaceFolder && !IS_MULTI_ROOT_TEST()) {
        return;
    }
    const resourceUri = typeof resource === 'string' ? vscode.Uri.file(resource) : resource;
    const settings = vscode.workspace.getConfiguration('files', resourceUri || null);
    const value = settings.inspect<number>('autoSaveDelay');
    const prop: 'workspaceFolderValue' | 'workspaceValue' =
        config === vscode.ConfigurationTarget.Workspace ? 'workspaceValue' : 'workspaceFolderValue';
    if (value && value[prop] !== delayinMS) {
        await settings.update('autoSaveDelay', delayinMS, config);
        await settings.update('autoSave', 'afterDelay');
    }
}

async function setPythonPathInWorkspace(
    resource: string | Uri | undefined,
    config: ConfigurationTarget,
    pythonPath?: string
) {
    const vscode = require('vscode') as typeof import('vscode');
    if (config === vscode.ConfigurationTarget.WorkspaceFolder && !IS_MULTI_ROOT_TEST()) {
        return;
    }
    const resourceUri = typeof resource === 'string' ? vscode.Uri.file(resource) : resource;
    const settings = vscode.workspace.getConfiguration('python', resourceUri || null);
    const value = settings.inspect<string>('defaultInterpreterPath');
    const prop: 'workspaceFolderValue' | 'workspaceValue' =
        config === vscode.ConfigurationTarget.Workspace ? 'workspaceValue' : 'workspaceFolderValue';
    if (!value || value[prop] !== pythonPath) {
        console.log(`Updating Interpreter path to ${pythonPath} in workspace`);
        await settings.update('pythonPath', pythonPath, config).then(noop, noop);
        await settings.update('defaultInterpreterPath', pythonPath, config).then(noop, noop);
        if (config === vscode.ConfigurationTarget.Global) {
            await settings.update('defaultInterpreterPath', pythonPath, config).then(noop, noop);
        }
    } else {
        console.log(`No need to update Interpreter path, as it is ${value[prop]} in workspace`);
    }
}
function getPythonPath(): string {
    if (process.env.CI_PYTHON_PATH && fs.existsSync(process.env.CI_PYTHON_PATH)) {
        return process.env.CI_PYTHON_PATH;
    }
    // eslint-disable-next-line
    // TODO: Change this to python3.
    // See https://github.com/microsoft/vscode-python/issues/10910.
    return 'python';
}

/**
 * Get the current Python interpreter version.
 *
 * @param {procService} IProcessService Optionally specify the IProcessService implementation to use to execute with.
 * @return `SemVer` version of the Python interpreter, or `undefined` if an error occurs.
 */
export async function getPythonSemVer(procService?: IProcessService): Promise<SemVer | undefined> {
    const proc = await import('../platform/common/process/proc.node');
    const pythonProcRunner = procService ? procService : new proc.ProcessService();
    const pyVerArgs = ['-c', 'import sys;print("{0}.{1}.{2}".format(*sys.version_info[:3]))'];

    return pythonProcRunner
        .exec(PYTHON_PATH, pyVerArgs)
        .then((strVersion) => new SemVer(strVersion.stdout.trim()))
        .catch((err) => {
            // if the call fails this should make it loudly apparent.
            console.error('Failed to get Python Version in getPythonSemVer', err);
            return undefined;
        });
}

/**
 * Match a given semver version specification with a list of loosely defined
 * version strings.
 *
 * Specify versions by their major version at minimum - the minor and patch
 * version numbers are optional.
 *
 * '3', '3.6', '3.6.6', are all vald and only the portions specified will be matched
 * against the current running Python interpreter version.
 *
 * Example scenarios:
 * '3' will match version 3.5.6, 3.6.4, 3.6.6, and 3.7.0.
 * '3.6' will match version 3.6.4 and 3.6.6.
 * '3.6.4' will match version 3.6.4 only.
 *
 * @param {version} SemVer the version to look for.
 * @param {searchVersions} string[] List of loosely-specified versions to match against.
 */
export function isVersionInList(version: SemVer, ...searchVersions: string[]): boolean {
    // see if the major/minor version matches any member of the skip-list.
    const isPresent = searchVersions.findIndex((ver) => {
        const semverChecker = coerce(ver);
        if (semverChecker) {
            if (semverChecker.compare(version) === 0) {
                return true;
            } else {
                // compare all the parts of the version that we have, we know we have
                // at minimum the major version or semverChecker would be 'null'...
                const versionParts = ver.split('.');
                let matches = parseInt(versionParts[0], 10) === version.major;

                if (matches && versionParts.length >= 2) {
                    matches = parseInt(versionParts[1], 10) === version.minor;
                }

                if (matches && versionParts.length >= 3) {
                    matches = parseInt(versionParts[2], 10) === version.patch;
                }

                return matches;
            }
        }
        return false;
    });

    if (isPresent >= 0) {
        return true;
    }
    return false;
}

/**
 * Determine if the current interpreter version is in a given selection of versions.
 *
 * You can specify versions by using up to the first three semver parts of a python
 * version.
 *
 * '3', '3.6', '3.6.6', are all vald and only the portions specified will be matched
 * against the current running Python interpreter version.
 *
 * Example scenarios:
 * '3' will match version 3.5.6, 3.6.4, 3.6.6, and 3.7.0.
 * '3.6' will match version 3.6.4 and 3.6.6.
 * '3.6.4' will match version 3.6.4 only.
 *
 * If you need to specify the environment (ie. the workspace) that the Python
 * interpreter is running under, use `isPythonVersionInProcess` instead.
 *
 * @param {versions} string[] List of versions of python that are to be skipped.
 * @param {resource} vscode.Uri Current workspace resource Uri or undefined.
 * @return true if the current Python version matches a version in the skip list, false otherwise.
 */
export async function isPythonVersion(...versions: string[]): Promise<boolean> {
    const currentPyVersion = await getPythonSemVer();
    if (currentPyVersion) {
        return isVersionInList(currentPyVersion, ...versions);
    } else {
        console.error(
            `Failed to determine the current Python version when comparing against list [${versions.join(', ')}].`
        );
        return false;
    }
}

export async function unzip(zipFile: string, targetFolder: string): Promise<void> {
    await fs.ensureDir(targetFolder);
    return new Promise<void>((resolve, reject) => {
        const zip = new StreamZip({
            file: zipFile,
            storeEntries: true
        });
        zip.on('ready', async () => {
            zip.extract('extension', targetFolder, (err: any) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
                zip.close();
            });
        });
    });
}

export async function openFile(file: string): Promise<TextDocument> {
    const vscode = require('vscode') as typeof import('vscode');
    const textDocument = await vscode.workspace.openTextDocument(file);
    await vscode.window.showTextDocument(textDocument);
    assert(vscode.window.activeTextEditor, 'No active editor');
    return textDocument;
}
/**
 * Captures screenshots (png format) & dumpts into root directory (only on CI).
 * If there's a failure, it will be logged (errors are swallowed).
 */
export async function captureScreenShot(contextOrFileName: string | Mocha.Context) {
    if (!isCI) {
        return;
    }
    fs.ensureDirSync(path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'logs'));
    const filename = path.join(
        EXTENSION_ROOT_DIR_FOR_TESTS,
        'logs',
        await generateScreenShotFileName(contextOrFileName)
    );
    try {
        const screenshot = require('screenshot-desktop');
        await screenshot({ filename });
        console.info(`Screenshot captured into ${filename}`);
    } catch (ex) {
        console.error(`Failed to capture screenshot into ${filename}`, ex);
    }
}

export function initializeCommonNodeApi() {
    const { commands, Uri } = require('vscode');
    const { initialize } = require('./initialize.node');

    initializeCommonApi({
        async createTemporaryFile(options: {
            contents?: string;
            extension: string;
        }): Promise<{ file: Uri } & IDisposable> {
            const extension = options.extension || '.py';
            const tempFile = tmp.tmpNameSync({ postfix: extension });
            if (options.contents) {
                await fs.writeFile(tempFile, options.contents);
            }
            return { file: Uri.file(tempFile), dispose: () => swallowExceptions(() => fs.unlinkSync(tempFile)) };
        },
        async startJupyterServer(notebook?: NotebookDocument, useCert: boolean = false): Promise<any> {
            if (IS_REMOTE_NATIVE_TEST()) {
                const uriString = useCert
                    ? await JupyterServer.instance.startJupyterWithCert()
                    : await JupyterServer.instance.startJupyterWithToken();
                console.info(`Jupyter started and listening at ${uriString}`);
                try {
                    await commands.executeCommand('jupyter.selectjupyteruri', false, Uri.parse(uriString), notebook);
                } catch (ex) {
                    console.error('Failed to select jupyter server, retry in 1s', ex);
                }
                // Todo: Fix in debt week, we need to retry, some changes have caused the first connection attempt to fail on CI.
                // Possible we're trying to connect before the server is ready.
                await sleep(5_000);
                await commands.executeCommand('jupyter.selectjupyteruri', false, Uri.parse(uriString), notebook);
            } else {
                console.info(`Jupyter not started and set to local`); // This is the default
            }
        },
        async stopJupyterServer() {
            if (IS_REMOTE_NATIVE_TEST()) {
                return;
            }
            await JupyterServer.instance.dispose().catch(noop);
        },
        async initialize() {
            return initialize();
        },
        captureScreenShot
    });
}
