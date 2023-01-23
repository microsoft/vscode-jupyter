// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fsapi from 'fs-extra';
import * as path from '../../../platform/vscode-path/path';
import { ShellOptions, ExecutionResult, IProcessServiceFactory } from '../process/types.node';
import { IConfigurationService } from '../types';
import { IServiceContainer } from '../../ioc/types';
import { normCasePath } from './fileUtils';
export { arePathsSame } from './fileUtils';
import { untildify as untilidfyCommon } from '../utils/platform';
import { homedir } from 'os';

let internalServiceContainer: IServiceContainer;
export function initializeExternalDependencies(serviceContainer: IServiceContainer): void {
    internalServiceContainer = serviceContainer;
}

// processes

export async function shellExecute(command: string, options: ShellOptions = {}): Promise<ExecutionResult<string>> {
    const service = await internalServiceContainer.get<IProcessServiceFactory>(IProcessServiceFactory).create();
    return service.shellExec(command, options);
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

export const untildify: (value: string) => string = (value) => untilidfyCommon(value, homedir());

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
