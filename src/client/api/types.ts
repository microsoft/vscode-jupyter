// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { CancellationToken, Disposable, Event, Uri } from 'vscode';
import * as lsp from 'vscode-languageserver-protocol';
import { InterpreterUri } from '../common/installer/types';
import { InstallerResponse, Product, Resource } from '../common/types';
import { IInterpreterQuickPickItem } from '../interpreter/configuration/types';
import { PythonEnvironment } from '../pythonEnvironments/info';
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
    getApi(): Promise<PythonApi>;
    setApi(api: PythonApi): void;
}
export const IPythonExtensionChecker = Symbol('IPythonExtensionChecker');
export interface IPythonExtensionChecker {
    readonly isPythonExtensionInstalled: boolean;
    showPythonExtensionInstallRequiredPrompt(): Promise<void>;
    showPythonExtensionInstallRecommendedPrompt(): Promise<void>;
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
    pandas = 'pandas'
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
        interpreter?: PythonEnvironment,
        allowExceptions?: boolean
    ): Promise<NodeJS.ProcessEnv | undefined>;
    isWindowsStoreInterpreter(pythonPath: string): Promise<boolean>;
    /**
     * IWindowsStoreInterpreter
     */
    getSuggestions(resource: Resource): Promise<IInterpreterQuickPickItem[]>;
    /**
     * IInstaller
     */
    install(
        product: JupyterProductToInstall,
        resource?: InterpreterUri,
        cancel?: CancellationToken
    ): Promise<InstallerResponse>;
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
};

export const IPythonInstaller = Symbol('IPythonInstaller');
export interface IPythonInstaller {
    install(product: Product, resource?: InterpreterUri, cancel?: CancellationToken): Promise<InstallerResponse>;
}

export const IPythonDebuggerPathProvider = Symbol('IPythonDebuggerPathProvider');
export interface IPythonDebuggerPathProvider {
    getDebuggerPath(): Promise<string>;
}

export const ILanguageServerProvider = Symbol('ILanguageServerProvider');
export interface ILanguageServerProvider {
    getLanguageServer(resource?: InterpreterUri): Promise<ILanguageServer | undefined>;
}
