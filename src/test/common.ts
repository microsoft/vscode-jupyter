// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

/* eslint-disable no-console, @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

import * as assert from 'assert';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as uuid from 'uuid/v4';
import { coerce, SemVer } from 'semver';
import type { ConfigurationTarget, Event, TextDocument, Uri } from 'vscode';
import { IExtensionApi } from '../client/api';
import { IProcessService } from '../client/common/process/types';
import { IDisposable, IJupyterSettings } from '../client/common/types';
import { IServiceContainer, IServiceManager } from '../client/ioc/types';
import { EXTENSION_ROOT_DIR_FOR_TESTS, IS_MULTI_ROOT_TEST, IS_PERF_TEST, IS_SMOKE_TEST } from './constants';
import { noop } from './core';
import { isCI } from '../client/common/constants';

const StreamZip = require('node-stream-zip');

export { sleep } from './core';

/* eslint-disable no-invalid-this, @typescript-eslint/no-explicit-any */

const fileInNonRootWorkspace = path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'test', 'pythonFiles', 'dummy.py');
export const rootWorkspaceUri = getWorkspaceRoot();

export const PYTHON_PATH = getPythonPath();
// Useful to see on CI (when working with conda & non-conda, virtual envs & the like).
console.log(`Python used in tests is ${PYTHON_PATH}`);

export enum OSType {
    Unknown = 'Unknown',
    Windows = 'Windows',
    OSX = 'OSX',
    Linux = 'Linux'
}

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
    if (IS_SMOKE_TEST || IS_PERF_TEST) {
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

export function getExtensionSettings(resource: Uri | undefined): IJupyterSettings {
    const pythonSettings = require('../client/common/configSettings') as typeof import('../client/common/configSettings');
    return pythonSettings.JupyterSettings.getInstance(resource);
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
    if (config === vscode.ConfigurationTarget.WorkspaceFolder && !IS_MULTI_ROOT_TEST) {
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
    if (config === vscode.ConfigurationTarget.WorkspaceFolder && !IS_MULTI_ROOT_TEST) {
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

export function getOSType(): OSType {
    const platform: string = process.platform;
    if (/^win/.test(platform)) {
        return OSType.Windows;
    } else if (/^darwin/.test(platform)) {
        return OSType.OSX;
    } else if (/^linux/.test(platform)) {
        return OSType.Linux;
    } else {
        return OSType.Unknown;
    }
}

/**
 * Get the current Python interpreter version.
 *
 * @param {procService} IProcessService Optionally specify the IProcessService implementation to use to execute with.
 * @return `SemVer` version of the Python interpreter, or `undefined` if an error occurs.
 */
export async function getPythonSemVer(procService?: IProcessService): Promise<SemVer | undefined> {
    const decoder = await import('../client/common/process/decoder');
    const proc = await import('../client/common/process/proc');

    const pythonProcRunner = procService ? procService : new proc.ProcessService(new decoder.BufferDecoder());
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

export interface IExtensionTestApi extends IExtensionApi {
    serviceContainer: IServiceContainer;
    serviceManager: IServiceManager;
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

const pendingTimers: any[] = [];
export function clearPendingTimers() {
    while (pendingTimers.length) {
        const timer = pendingTimers.shift();
        try {
            clearTimeout(timer);
        } catch {
            // Noop.
        }
        try {
            clearInterval(timer);
        } catch {
            // Noop.
        }
    }
}
/**
 * Wait for a condition to be fulfilled within a timeout.
 *
 * @export
 * @param {() => Promise<boolean>} condition
 * @param {number} timeoutMs
 * @param {string} errorMessage
 * @returns {Promise<void>}
 */
export async function waitForCondition(
    condition: () => Promise<boolean>,
    timeoutMs: number,
    errorMessage: string | (() => string),
    intervalTimeoutMs: number = 10,
    throwOnError: boolean = false
): Promise<void> {
    return new Promise<void>(async (resolve, reject) => {
        const timeout = setTimeout(() => {
            clearTimeout(timeout);
            // eslint-disable-next-line @typescript-eslint/no-use-before-define
            clearTimeout(timer);
            errorMessage = typeof errorMessage === 'string' ? errorMessage : errorMessage();
            console.log(`Test failing --- ${errorMessage}`);
            reject(new Error(errorMessage));
        }, timeoutMs);
        let timer: NodeJS.Timer;
        const timerFunc = async () => {
            let success = false;
            try {
                success = await condition();
            } catch (exc) {
                if (throwOnError) {
                    reject(exc);
                }
            }
            if (!success) {
                // Start up a timer again, but don't do it until after
                // the condition is false.
                timer = setTimeout(timerFunc, intervalTimeoutMs);
            } else {
                clearTimeout(timer);
                clearTimeout(timeout);
                resolve();
            }
        };
        timer = setTimeout(timerFunc, intervalTimeoutMs);

        pendingTimers.push(timer);
        pendingTimers.push(timeout);
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
 * Helper class to test events.
 *
 * Usage: Assume xyz.onDidSave is the event we want to test.
 * const handler = new TestEventHandler(xyz.onDidSave);
 * // Do something that would trigger the event.
 * assert.ok(handler.fired)
 * assert.equal(handler.first, 'Args Passed to first onDidSave')
 * assert.equal(handler.count, 1)// Only one should have been fired.
 */
export class TestEventHandler<T extends void | any = any> implements IDisposable {
    public get fired() {
        return this.handledEvents.length > 0;
    }
    public get first(): T {
        return this.handledEvents[0];
    }
    public get second(): T {
        return this.handledEvents[1];
    }
    public get last(): T {
        return this.handledEvents[this.handledEvents.length - 1];
    }
    public get count(): number {
        return this.handledEvents.length;
    }
    public get all(): T[] {
        return this.handledEvents;
    }
    private readonly handler: IDisposable;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly handledEvents: any[] = [];
    constructor(event: Event<T>, private readonly eventNameForErrorMessages: string, disposables: IDisposable[] = []) {
        disposables.push(this);
        this.handler = event(this.listener, this);
    }
    public reset() {
        while (this.handledEvents.length) {
            this.handledEvents.pop();
        }
    }
    public async assertFired(waitPeriod: number = 100): Promise<void> {
        await waitForCondition(async () => this.fired, waitPeriod, `${this.eventNameForErrorMessages} event not fired`);
    }
    public async assertFiredExactly(numberOfTimesFired: number, waitPeriod: number = 2_000): Promise<void> {
        await waitForCondition(
            async () => this.count === numberOfTimesFired,
            waitPeriod,
            `${this.eventNameForErrorMessages} event fired ${this.count}, expected ${numberOfTimesFired}`
        );
    }
    public async assertFiredAtLeast(numberOfTimesFired: number, waitPeriod: number = 2_000): Promise<void> {
        await waitForCondition(
            async () => this.count >= numberOfTimesFired,
            waitPeriod,
            `${this.eventNameForErrorMessages} event fired ${this.count}, expected at least ${numberOfTimesFired}.`
        );
    }
    public atIndex(index: number): T {
        return this.handledEvents[index];
    }

    public dispose() {
        this.handler.dispose();
    }

    private listener(e: T) {
        this.handledEvents.push(e);
    }
}

export function createEventHandler<T, K extends keyof T>(
    obj: T,
    eventName: K,
    disposables: IDisposable[] = []
): T[K] extends Event<infer TArgs> ? TestEventHandler<TArgs> : TestEventHandler<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new TestEventHandler(obj[eventName] as any, eventName as string, disposables) as any;
}

/**
 * Captures screenshots (png format) & dumpts into root directory (only on CI).
 * If there's a failure, it will be logged (errors are swallowed).
 */
export async function captureScreenShot(fileNamePrefix: string) {
    if (!isCI) {
        return;
    }
    const name = `${fileNamePrefix}_${uuid()}`.replace(/[\W]+/g, '_');
    const filename = path.join(EXTENSION_ROOT_DIR_FOR_TESTS, `${name}-screenshot.png`);
    try {
        const screenshot = require('screenshot-desktop');
        await screenshot({ filename });
        console.info(`Screenshot captured into ${filename}`);
    } catch (ex) {
        console.error(`Failed to capture screenshot into ${filename}`, ex);
    }
}
