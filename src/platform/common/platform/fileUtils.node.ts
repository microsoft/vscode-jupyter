// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { IDisposable } from '@fluentui/react';
import * as fsapi from 'fs-extra';
import * as path from '../../../platform/vscode-path/path';
import * as vscode from 'vscode';
import { ShellOptions, ExecutionResult, IProcessServiceFactory, SpawnOptions } from '../process/types.node';
import { IConfigurationService } from '../types';
import { chain, iterable } from '../utils/async';
import { IServiceContainer } from '../../ioc/types';
import { getOSType, OSType } from '../utils/platform';
import { normCasePath } from './fileUtils';
export { arePathsSame } from './fileUtils';

let internalServiceContainer: IServiceContainer;
export function initializeExternalDependencies(serviceContainer: IServiceContainer): void {
    internalServiceContainer = serviceContainer;
}

// processes

export async function shellExecute(command: string, options: ShellOptions = {}): Promise<ExecutionResult<string>> {
    const service = await internalServiceContainer.get<IProcessServiceFactory>(IProcessServiceFactory).create();
    return service.shellExec(command, options);
}

export async function exec(file: string, args: string[], options: SpawnOptions = {}): Promise<ExecutionResult<string>> {
    const service = await internalServiceContainer.get<IProcessServiceFactory>(IProcessServiceFactory).create();
    return service.exec(file, args, options);
}

// filesystem

export function pathExists(absPath: string): Promise<boolean> {
    return fsapi.pathExists(absPath);
}

export function pathExistsSync(absPath: string): boolean {
    return fsapi.pathExistsSync(absPath);
}

export function readFile(filePath: string): Promise<string> {
    return fsapi.readFile(filePath, 'utf-8');
}

export function readFileSync(filePath: string): string {
    return fsapi.readFileSync(filePath, 'utf-8');
}

// eslint-disable-next-line global-require
export const untildify: (value: string) => string = require('untildify');

/**
 * Returns true if given file path exists within the given parent directory, false otherwise.
 * @param filePath File path to check for
 * @param parentPath The potential parent path to check for
 */
export function isParentPath(filePath: string, parentPath: string): boolean {
    if (!parentPath.endsWith(path.sep)) {
        parentPath += path.sep;
    }
    if (!filePath.endsWith(path.sep)) {
        filePath += path.sep;
    }
    return normCasePath(filePath).startsWith(normCasePath(parentPath));
}

export async function isDirectory(filename: string): Promise<boolean> {
    const stat = await fsapi.lstat(filename);
    return stat.isDirectory();
}

/**
 * Produce a uniform representation of the given filename.
 *
 * The result is especially suitable for cases where a filename is used
 * as a key (e.g. in a mapping).
 */
export function normalizeFilename(filename: string): string {
    // `path.resolve()` returns the absolute path.  Note that it also
    // has the same behavior as `path.normalize()`.
    const resolved = path.resolve(filename);
    return getOSType() === OSType.Windows ? resolved.toLowerCase() : resolved;
}

export function normalizePath(filename: string): string {
    return normalizeFilename(filename);
}

export function resolvePath(filename: string): string {
    return path.resolve(filename);
}

export function getWorkspaceFolders(): string[] {
    return vscode.workspace.workspaceFolders?.map((w) => w.uri.fsPath) ?? [];
}

export async function resolveSymbolicLink(absPath: string): Promise<string> {
    const stats = await fsapi.lstat(absPath);
    if (stats.isSymbolicLink()) {
        const link = await fsapi.readlink(absPath);
        // Result from readlink is not guaranteed to be an absolute path. For eg. on Mac it resolves
        // /usr/local/bin/python3.9 -> ../../../Library/Frameworks/Python.framework/Versions/3.9/bin/python3.9
        //
        // The resultant path is reported relative to the symlink directory we resolve. Convert that to absolute path.
        const absLinkPath = path.isAbsolute(link) ? link : path.resolve(path.dirname(absPath), link);
        return resolveSymbolicLink(absLinkPath);
    }
    return absPath;
}

/**
 * Returns full path to sub directories of a given directory.
 * @param {string} root : path to get sub-directories from.
 * @param options : If called with `resolveSymlinks: true`, then symlinks found in
 *                  the directory are resolved and if they resolve to directories
 *                  then resolved values are returned.
 */
export async function* getSubDirs(
    root: string,
    options?: { resolveSymlinks?: boolean }
): AsyncIterableIterator<string> {
    const dirContents = await fsapi.promises.readdir(root, { withFileTypes: true });
    const generators = dirContents.map((item) => {
        async function* generator() {
            const fullPath = path.join(root, item.name);
            if (item.isDirectory()) {
                yield fullPath;
            } else if (options?.resolveSymlinks && item.isSymbolicLink()) {
                // The current FS item is a symlink. It can potentially be a file
                // or a directory. Resolve it first and then check if it is a directory.
                const resolvedPath = await resolveSymbolicLink(fullPath);
                const resolvedPathStat = await fsapi.lstat(resolvedPath);
                if (resolvedPathStat.isDirectory()) {
                    yield resolvedPath;
                }
            }
        }

        return generator();
    });

    yield* iterable(chain(generators));
}

/**
 * Returns the value for setting `python.<name>`.
 * @param name The name of the setting.
 */
export function getPythonSetting<T>(name: string): T | undefined {
    const settings = internalServiceContainer.get<IConfigurationService>(IConfigurationService).getSettings();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (settings as any)[name];
}

/**
 * Registers the listener to be called when a particular setting changes.
 * @param name The name of the setting.
 * @param callback The listener function to be called when the setting changes.
 */
export function onDidChangePythonSetting(name: string, callback: () => void): IDisposable {
    return vscode.workspace.onDidChangeConfiguration((event: vscode.ConfigurationChangeEvent) => {
        if (event.affectsConfiguration(`python.${name}`)) {
            callback();
        }
    });
}

/**
 * Gets the root environment directory based on the absolute path to the python
 *  interpreter binary.
 * @param interpreterPath Absolute path to the python interpreter
 */
export function getEnvironmentDirFromPath(interpreterPath: string): string {
    const skipDirs = ['bin', 'scripts'];

    // env <--- Return this directory if it is not 'bin' or 'scripts'
    // |__ python  <--- interpreterPath
    const dir = path.basename(path.dirname(interpreterPath));
    if (!skipDirs.map((e) => normCasePath(e)).includes(normCasePath(dir))) {
        return path.dirname(interpreterPath);
    }

    // This is the best next guess.
    // env <--- Return this directory if it is not 'bin' or 'scripts'
    // |__ bin or Scripts
    //     |__ python  <--- interpreterPath
    return path.dirname(path.dirname(interpreterPath));
}

/**
 * Checks if the given interpreter belongs to a virtualenv based environment.
 * @param {string} interpreterPath: Absolute path to the python interpreter.
 * @returns {boolean} : Returns true if the interpreter belongs to a virtualenv environment.
 */
export async function isVirtualenvEnvironment(interpreterPath: string): Promise<boolean> {
    // Check if there are any activate.* files in the same directory as the interpreter.
    //
    // env
    // |__ activate, activate.*  <--- check if any of these files exist
    // |__ python  <--- interpreterPath
    const directory = path.dirname(interpreterPath);
    const files = await fsapi.readdir(directory);
    const regex = /^activate(\.([A-z]|\d)+)?$/i;

    return files.find((file) => regex.test(file)) !== undefined;
}
