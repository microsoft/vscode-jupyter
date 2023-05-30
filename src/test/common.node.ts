// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable no-console, @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

import assert from 'assert';
import * as fs from 'fs-extra';
import * as path from '../platform/vscode-path/path';
import * as tmp from 'tmp';
import * as os from 'os';
import { EXTENSION_ROOT_DIR_FOR_TESTS, IS_MULTI_ROOT_TEST, IS_REMOTE_NATIVE_TEST } from './constants.node';
import { noop, sleep } from './core';
import { isCI } from '../platform/common/constants';
import { IWorkspaceService } from '../platform/common/application/types';
import { generateScreenShotFileName, initializeCommonApi } from './common';
import { IDisposable } from '../platform/common/types';
import { swallowExceptions } from '../platform/common/utils/misc';
import { JupyterServer } from './datascience/jupyterServer.node';
import type { ConfigurationTarget, TextDocument, Uri } from 'vscode';

export { createEventHandler } from './common';

const StreamZip = require('node-stream-zip');

export { sleep } from './core';

export * from './common';

/* eslint-disable no-invalid-this, @typescript-eslint/no-explicit-any */

export const PYTHON_PATH = getPythonPath();
// Useful to see on CI (when working with conda & non-conda, virtual envs & the like).
console.log(`Python used in tests is ${PYTHON_PATH}`);
export async function setPythonPathInWorkspaceRoot(pythonPath: string) {
    const vscode = require('vscode') as typeof import('vscode');
    return retryAsync(setPythonPathInWorkspace)(undefined, vscode.ConfigurationTarget.Workspace, pythonPath);
}

export async function setAutoSaveDelayInWorkspaceRoot(delayinMS: number) {
    const vscode = require('vscode') as typeof import('vscode');
    return retryAsync(setAutoSaveDelay)(undefined, vscode.ConfigurationTarget.Workspace, delayinMS);
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
/**
 * Sometimes on CI, we have paths such as (this could happen on user machines as well)
 *  - /opt/hostedtoolcache/Python/3.8.11/x64/python
 *  - /opt/hostedtoolcache/Python/3.8.11/x64/bin/python
 *  They are both the same.
 * This function will take that into account.
 */
function getNormalizedInterpreterPath(fsPath: string) {
    if (os.platform() === 'win32') {
        return fsPath.toLowerCase();
    }

    // No need to generate hashes, its unnecessarily slow.
    if (!fsPath.endsWith('/bin/python')) {
        return fsPath;
    }
    // Sometimes on CI, we have paths such as (this could happen on user machines as well)
    // - /opt/hostedtoolcache/Python/3.8.11/x64/python
    // - /opt/hostedtoolcache/Python/3.8.11/x64/bin/python
    // They are both the same.
    // To ensure we treat them as the same, lets drop the `bin` on unix.
    // We need to exclude paths such as `/usr/bin/python`
    const filePath =
        fsPath.endsWith('/bin/python') && fsPath.split('/').length > 4
            ? fsPath.replace('/bin/python', '/python')
            : fsPath;
    return fs.existsSync(filePath) ? filePath : fsPath;
}

function getPythonPath(): string {
    if (process.env.CI_PYTHON_PATH && fs.existsSync(process.env.CI_PYTHON_PATH)) {
        return getNormalizedInterpreterPath(process.env.CI_PYTHON_PATH);
    }
    // eslint-disable-next-line
    // TODO: Change this to python3.
    // See https://github.com/microsoft/vscode-python/issues/10910.
    return 'python';
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

let remoteUrisCleared = false;
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
        async startJupyterServer(
            options: {
                token?: string;
                port?: number;
                useCert?: boolean;
                jupyterLab?: boolean;
                password?: string;
                detached?: boolean;
                standalone?: boolean;
            } = {}
        ): Promise<string> {
            if (IS_REMOTE_NATIVE_TEST()) {
                if (options.standalone) {
                    const url = JupyterServer.instance.startJupyter(options);
                    // Todo: Fix in debt week, we need to retry, some changes have caused the first connection attempt to fail on CI.
                    // Possible we're trying to connect before the server is ready.
                    await sleep(5_000);
                    return url;
                }
                if (!remoteUrisCleared) {
                    await commands.executeCommand('jupyter.clearSavedJupyterUris');
                    remoteUrisCleared = true;
                }
                const uriString = options.useCert
                    ? await JupyterServer.instance.startJupyterWithCert()
                    : await JupyterServer.instance.startJupyterWithToken();
                console.info(`Jupyter started and listening at ${uriString}`);
                try {
                    await commands.executeCommand('jupyter.selectjupyteruri', Uri.parse(uriString));
                } catch (ex) {
                    console.error('Failed to select jupyter server, retry in 1s', ex);
                }
                // Todo: Fix in debt week, we need to retry, some changes have caused the first connection attempt to fail on CI.
                // Possible we're trying to connect before the server is ready.
                await sleep(5_000);
                await commands.executeCommand('jupyter.selectjupyteruri', Uri.parse(uriString));
                return uriString;
            } else {
                console.info(`Jupyter not started and set to local`); // This is the default
                return '';
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
