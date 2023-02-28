// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationTokenSource, Event, Uri } from 'vscode';
import { InterpreterUri } from '../../common/types';
import { PythonEnvironment } from '../../pythonEnvironments/info';

export enum InstallerResponse {
    Installed,
    Disabled,
    Ignore,
    Cancelled
}

export enum Product {
    jupyter = 18,
    ipykernel = 19,
    notebook = 20,
    kernelspec = 21,
    nbconvert = 22,
    pandas = 23,
    pip = 27,
    ensurepip = 28
}

export enum ProductInstallStatus {
    Installed,
    NotInstalled,
    NeedsUpgrade
}

export enum ModuleNamePurpose {
    install = 1,
    run = 2
}

/**
 * The IModuleInstaller implementations.
 */
export enum ModuleInstallerType {
    Unknown = 'Unknown',
    Conda = 'Conda',
    Pip = 'Pip',
    Poetry = 'Poetry',
    Pipenv = 'Pipenv'
}

export enum ProductType {
    Linter = 'Linter',
    Formatter = 'Formatter',
    TestFramework = 'TestFramework',
    RefactoringLibrary = 'RefactoringLibrary',
    DataScience = 'DataScience'
}

export const IModuleInstaller = Symbol('IModuleInstaller');
export interface IModuleInstaller {
    readonly name: string;
    readonly displayName: string;
    readonly priority: number;
    readonly type: ModuleInstallerType;
    /**
     * Installs a module
     * If a cancellation token is provided, then a cancellable progress message is dispalyed.
     *  At this point, this method would resolve only after the module has been successfully installed.
     * If cancellation token is not provided, its not guaranteed that module installation has completed.
     * @param {string} name
     * @param {InterpreterUri} [resource]
     * @param {CancellationToken} [cancel]
     * @returns {Promise<void>}
     * @memberof IModuleInstaller
     */
    installModule(
        product: string,
        interpreter: PythonEnvironment,
        cancelTokenSource: CancellationTokenSource,
        flags?: ModuleInstallFlags
    ): Promise<void>;
    /**
     * Installs a Product
     * If a cancellation token is provided, then a cancellable progress message is dispalyed.
     *  At this point, this method would resolve only after the module has been successfully installed.
     * If cancellation token is not provided, its not guaranteed that module installation has completed.
     * @param {string} name
     * @param {InterpreterUri} [resource]
     * @param {CancellationToken} [cancel]
     * @returns {Promise<void>}
     * @memberof IModuleInstaller
     */
    installModule(
        product: Product,
        interpreter: PythonEnvironment,
        cancelTokenSource: CancellationTokenSource,
        flags?: ModuleInstallFlags
    ): Promise<void>;
    isSupported(resource?: InterpreterUri): Promise<boolean>;
}

export const IPythonInstallation = Symbol('IPythonInstallation');
export interface IPythonInstallation {
    checkInstallation(): Promise<boolean>;
}

export const IInstallationChannelManager = Symbol('IInstallationChannelManager');
export interface IInstallationChannelManager {
    getInstallationChannel(product: Product, interpreter: PythonEnvironment): Promise<IModuleInstaller | undefined>;
    getInstallationChannels(interpreter: PythonEnvironment): Promise<IModuleInstaller[]>;
    showNoInstallersMessage(interpreter: PythonEnvironment): void;
}
export const IProductService = Symbol('IProductService');
export interface IProductService {
    getProductType(product: Product): ProductType;
}
export const IProductPathService = Symbol('IProductPathService');
export interface IProductPathService {
    getExecutableNameFromSettings(product: Product, resource?: Uri): string;
    isExecutableAModule(product: Product, resource?: Uri): boolean;
}

export enum ModuleInstallFlags {
    upgrade = 1,
    updateDependencies = 2,
    reInstall = 4,
    installPipIfRequired = 8
}

export const IInstaller = Symbol('IInstaller');

export interface IInstaller {
    readonly onInstalled: Event<{ product: Product; resource?: InterpreterUri }>;
    install(
        product: Product,
        resource: InterpreterUri,
        cancelTokenSource: CancellationTokenSource,
        reInstallAndUpdate?: boolean,
        installPipIfRequired?: boolean
    ): Promise<InstallerResponse>;
    isInstalled(product: Product, resource: InterpreterUri): Promise<boolean | undefined>;
    translateProductToModuleName(product: Product, purpose: ModuleNamePurpose): string;
}
