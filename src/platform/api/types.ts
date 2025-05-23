// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Event, Uri } from 'vscode';
import { Resource } from '../common/types';
import type { SemVer } from 'semver';
import { PythonVersion } from '../pythonEnvironments/info/pythonVersion';
import { EnvironmentPath, PythonExtension, type Environment } from '@vscode/python-extension';

export const IPythonApiProvider = Symbol('IPythonApi');
export interface IPythonApiProvider {
    onDidActivatePythonExtension: Event<void>;
    pythonExtensionHooked: Promise<void>;
    pythonExtensionVersion: SemVer | undefined;
    getApi(): Promise<PythonApi>;
    getNewApi(): Promise<PythonExtension | undefined>;
    setApi(api: PythonApi): void;
}
export const IPythonExtensionChecker = Symbol('IPythonExtensionChecker');
export interface IPythonExtensionChecker {
    readonly isPythonExtensionInstalled: boolean;
    readonly isPythonExtensionActive: boolean;
    showPythonExtensionInstallRequiredPrompt(): Promise<void>;
    directlyInstallPythonExtension(): Promise<void>;
    onPythonExtensionInstallationStatusChanged: Event<'installed' | 'uninstalled'>;
}

/**
 * This allows Python extension to update Product enum without breaking Jupyter.
 * I.e. we have a strict contract, else using numbers (in enums) is bound to break across products.
 */
export enum JupyterProductToInstall {
    jupyter = 'jupyter',
    ipykernel = 'ipykernel',
    notebook = 'notebook',
    kernelspec = 'kernelspec',
    nbconvert = 'nbconvert',
    pandas = 'pandas',
    pip = 'pip'
}

/**
 * Implement this interface to control the visibility of the interpreter statusbar.
 */
export interface IInterpreterStatusbarVisibilityFilter {
    readonly changed?: Event<void>;
    readonly hidden: boolean;
}

// Python extension still returns strings for paths
export type InterpreterInformation_PythonApi = {
    path: string;
    version?: PythonVersion;
    sysVersion?: string;
};

export interface PythonEnvironment_PythonApi extends InterpreterInformation_PythonApi {
    displayName?: string;
}

export interface PythonApi {
    /**
     * IEnvironmentActivationService
     */
    getActivatedEnvironmentVariables(
        resource: Resource,
        interpreter: Environment,
        allowExceptions?: boolean
    ): Promise<NodeJS.ProcessEnv | undefined>;
    /**
     * Retrieve interpreter path selected for Jupyter server from Python memento storage
     */
    getInterpreterPathSelectedForJupyterServer(): string | undefined;
    /**
     * Returns path to where `debugpy` is. In python extension this is `/pythonFiles/lib/python`.
     */
    getDebuggerPath(): Promise<string>;
    /**
     * Registers a visibility filter for the interpreter status bar.
     */
    registerInterpreterStatusFilter(filter: IInterpreterStatusbarVisibilityFilter): void;
    getCondaVersion?(): Promise<SemVer | undefined>;
    /**
     * Returns the conda executable.
     */
    getCondaFile?(): Promise<string | undefined>;

    /**
     * Call to provide a function that the Python extension can call to request the Python
     * path to use for a particular notebook.
     * @param func : The function that Python should call when requesting the Python path.
     */
    registerJupyterPythonPathFunction(func: (uri: Uri) => Promise<string | undefined>): void;
    /**
     * Returns the Environment that was last used in a Python tool.
     */
    getLastUsedEnvInLmTool?(uri: Uri): EnvironmentPath | undefined;
}
