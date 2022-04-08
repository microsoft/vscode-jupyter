// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Disposable, Event, Uri } from 'vscode';
import * as lsp from 'vscode-languageserver-protocol';
import { InterpreterUri, Resource } from '../common/types';
import { IInterpreterQuickPickItem } from '../interpreter/configuration/types';
import { PythonEnvironment } from '../pythonEnvironments/info';
import type { SemVer } from 'semver';
import { IExportedKernelService } from './extension';
export type ILanguageServerConnection = Pick<
    lsp.ProtocolConnection,
    'sendRequest' | 'sendNotification' | 'onProgress' | 'sendProgress' | 'onNotification' | 'onRequest'
>;

export interface ILanguageServer extends Disposable {
    readonly connection: ILanguageServerConnection;
    readonly capabilities: lsp.ServerCapabilities;
}

export const IPythonApiProvider = Symbol('IPythonApi');
export interface IPythonApiProvider {
    onDidActivatePythonExtension: Event<void>;
    getApi(): Promise<PythonApi>;
    setApi(api: PythonApi): void;
}
export const IPythonExtensionChecker = Symbol('IPythonExtensionChecker');
export interface IPythonExtensionChecker {
    readonly isPythonExtensionInstalled: boolean;
    readonly isPythonExtensionActive: boolean;
    showPythonExtensionInstallRequiredPrompt(): Promise<void>;
}

/**
 * This allows Python exntension to update Product enum without breaking Jupyter.
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

export type PythonApi = {
    /**
     * IInterpreterService
     */
    onDidChangeInterpreter: Event<void>;
    onDidChangeInterpreters: Event<void>;
    /**
     * IInterpreterService
     */
    getInterpreters(resource?: Uri): Promise<PythonEnvironment[]>;
    /**
     * IInterpreterService
     */
    getActiveInterpreter(resource?: Uri): Promise<PythonEnvironment | undefined>;
    /**
     * IInterpreterService
     */
    getInterpreterDetails(pythonPath: string, resource?: Uri): Promise<undefined | PythonEnvironment>;

    /**
     * IEnvironmentActivationService
     */
    getActivatedEnvironmentVariables(
        resource: Resource,
        interpreter: PythonEnvironment,
        allowExceptions?: boolean
    ): Promise<NodeJS.ProcessEnv | undefined>;
    /**
     * IWindowsStoreInterpreter
     */
    getSuggestions(resource: Resource): Promise<IInterpreterQuickPickItem[]>;
    /**
     * Retrieve interpreter path selected for Jupyter server from Python memento storage
     */
    getInterpreterPathSelectedForJupyterServer(): string | undefined;
    /**
     * Returns path to where `debugpy` is. In python extension this is `/pythonFiles/lib/python`.
     */
    getDebuggerPath(): Promise<string>;
    /**
     * Returns a ILanguageServer that can be used for communicating with a language server process.
     * @param resource file that determines which connection to return
     */
    getLanguageServer(resource?: InterpreterUri): Promise<ILanguageServer | undefined>;
    /**
     * Registers a visibility filter for the interpreter status bar.
     */
    registerInterpreterStatusFilter(filter: IInterpreterStatusbarVisibilityFilter): void;
    getCondaVersion?(): Promise<SemVer | undefined>;
    /**
     * Returns the conda executable.
     */
    getCondaFile?(): Promise<string | undefined>;
    getEnvironmentActivationShellCommands?(
        resource: Resource,
        interpreter?: PythonEnvironment
    ): Promise<string[] | undefined>;
    /**
     * This API will re-trigger environment discovery. Extensions can wait on the returned
     * promise to get the updated interpreters list. If there is a refresh already going on
     * then it returns the promise for that refresh.
     * @param options : [optional]
     *     * clearCache : When true, this will clear the cache before interpreter refresh
     *                    is triggered.
     */
    refreshInterpreters(options?: RefreshInterpretersOptions): Promise<string[] | undefined>;
    /**
     * Changes the active interpreter in use by the python extension
     * @param interpreterPath
     * @param resource
     */
    setActiveInterpreter(interpreterPath: string, resource?: Resource): Promise<void>;
};

export type RefreshInterpretersOptions = {
    clearCache?: boolean;
};
export type IPythonProposedApi = {
    environment: {
        /**
         * This API will re-trigger environment discovery. Extensions can wait on the returned
         * promise to get the updated interpreters list. If there is a refresh already going on
         * then it returns the promise for that refresh.
         * @param options : [optional]
         *     * clearCache : When true, this will clear the cache before interpreter refresh
         *                    is triggered.
         */
        refreshInterpreters(options?: RefreshInterpretersOptions): Promise<string[] | undefined>;
    };
};

export const IPythonDebuggerPathProvider = Symbol('IPythonDebuggerPathProvider');
export interface IPythonDebuggerPathProvider {
    getDebuggerPath(): Promise<string>;
}

export const ILanguageServerProvider = Symbol('ILanguageServerProvider');
export interface ILanguageServerProvider {
    getLanguageServer(resource?: InterpreterUri): Promise<ILanguageServer | undefined>;
}

export const IExportedKernelServiceFactory = Symbol('IExportedKernelServiceFactory');
export interface IExportedKernelServiceFactory {
    getService(): Promise<IExportedKernelService | undefined>;
}
