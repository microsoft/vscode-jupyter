// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Disposable, Event, QuickPickItem, Uri } from 'vscode';
import * as lsp from 'vscode-languageserver-protocol';
import { InterpreterUri, Resource } from '../common/types';
import type { SemVer } from 'semver';
import { PythonVersion } from '../pythonEnvironments/info/pythonVersion';
import { EnvironmentType } from '../pythonEnvironments/info';

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
    pythonExtensionHooked: Promise<void>;
    getApi(): Promise<PythonApi>;
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

// Python extension still returns strings for paths
export type InterpreterInformation_PythonApi = {
    path: string;
    version?: PythonVersion;
    sysVersion?: string;
    sysPrefix: string;
};

export type PythonEnvironment_PythonApi = InterpreterInformation_PythonApi & {
    displayName?: string;
    envType?: EnvironmentType;
    envName?: string;
    envPath?: string;
};

export interface IInterpreterQuickPickItem_PythonApi extends QuickPickItem {
    path: string;
    /**
     * The interpreter related to this quickpick item.
     *
     * @type {PythonEnvironment}
     * @memberof IInterpreterQuickPickItem
     */
    interpreter: PythonEnvironment_PythonApi;
}
export enum ProgressReportStage {
    discoveryStarted = 'discoveryStarted',
    allPathsDiscovered = 'allPathsDiscovered',
    discoveryFinished = 'discoveryFinished'
}

export type ProgressNotificationEvent = {
    stage: ProgressReportStage;
};

export type PythonApi = {
    /**
     * IInterpreterService
     */
    onDidChangeInterpreter: Event<void>;
    onDidChangeInterpreters: Event<void>;
    /**
     * IInterpreterService
     */
    getInterpreters(resource?: Uri): Promise<PythonEnvironment_PythonApi[]>;
    /**
     * IInterpreterService
     */
    getActiveInterpreter(resource?: Uri): Promise<PythonEnvironment_PythonApi | undefined>;
    /**
     * IInterpreterService
     */
    getInterpreterDetails(pythonPath: string, resource?: Uri): Promise<undefined | PythonEnvironment_PythonApi>;

    /**
     * IEnvironmentActivationService
     */
    getActivatedEnvironmentVariables(
        resource: Resource,
        interpreter: PythonEnvironment_PythonApi,
        allowExceptions?: boolean
    ): Promise<NodeJS.ProcessEnv | undefined>;
    /**
     * IWindowsStoreInterpreter
     */
    getSuggestions(resource: Resource): Promise<IInterpreterQuickPickItem_PythonApi[]>;
    getKnownSuggestions(resource: Resource): IInterpreterQuickPickItem_PythonApi[];
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
        interpreter?: PythonEnvironment_PythonApi
    ): Promise<string[] | undefined>;

    registerJupyterPythonPathFunction(func: (uri: Uri) => Promise<string | undefined>): void;
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
    /***
     * Returns a promise if a refresh is going on.
     */
    getRefreshPromise?(): Promise<void> | undefined;
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
