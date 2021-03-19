// eslint-disable-next-line
/* eslint-disable comma-dangle */
// eslint-disable-next-line
/* eslint-disable max-classes-per-file */
// eslint-disable-next-line
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
// eslint-disable-next-line
/* eslint-disable class-methods-use-this */
// eslint-disable-next-line
/* eslint-disable consistent-return */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { CancellationToken, Disposable, Event, EventEmitter, Uri } from 'vscode';
import { IApplicationShell, ICommandManager, IWorkspaceService } from '../common/application/types';
import { ProductNames } from '../common/installer/productNames';
import { InterpreterUri } from '../common/installer/types';
import {
    IDisposableRegistry,
    IExtensions,
    InstallerResponse,
    IPersistentStateFactory,
    Product,
    Resource
} from '../common/types';
import { createDeferred } from '../common/utils/async';
import * as localize from '../common/utils/localize';
import { noop } from '../common/utils/misc';
import { PythonExtension, Telemetry } from '../datascience/constants';
import { IEnvironmentActivationService } from '../interpreter/activation/types';
import { IInterpreterQuickPickItem, IInterpreterSelector } from '../interpreter/configuration/types';
import { IInterpreterService } from '../interpreter/contracts';
import { IWindowsStoreInterpreter } from '../interpreter/locators/types';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { sendTelemetryEvent } from '../telemetry';
import {
    ILanguageServer,
    ILanguageServerProvider,
    IPythonApiProvider,
    IPythonDebuggerPathProvider,
    IPythonExtensionChecker,
    IPythonInstaller,
    JupyterProductToInstall,
    PythonApi
} from './types';

/* eslint-disable max-classes-per-file */
@injectable()
export class PythonApiProvider implements IPythonApiProvider {
    private readonly api = createDeferred<PythonApi>();
    private readonly didActivePython = new EventEmitter<void>();
    public get onDidActivePythonExtension() {
        return this.didActivePython.event;
    }

    private initialized?: boolean;
    private hooksRegistered?: boolean;

    constructor(
        @inject(IExtensions) private readonly extensions: IExtensions,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IPythonExtensionChecker) private extensionChecker: IPythonExtensionChecker
    ) {
        const previouslyInstalled = this.extensionChecker.isPythonExtensionInstalled;
        if (!previouslyInstalled) {
            this.extensions.onDidChange(
                async () => {
                    if (this.extensionChecker.isPythonExtensionInstalled) {
                        await this.registerHooks();
                    }
                },
                this,
                this.disposables
            );
        }
    }

    public getApi(): Promise<PythonApi> {
        this.init().catch(noop);
        return this.api.promise;
    }

    public setApi(api: PythonApi): void {
        if (this.api.resolved) {
            return;
        }
        this.api.resolve(api);
    }

    private async init() {
        if (this.initialized) {
            return;
        }
        this.initialized = true;
        const pythonExtension = this.extensions.getExtension<{ jupyter: { registerHooks(): void } }>(PythonExtension);
        if (!pythonExtension) {
            await this.extensionChecker.showPythonExtensionInstallRequiredPrompt();
        } else {
            await this.registerHooks();
        }
    }
    private async registerHooks() {
        if (this.hooksRegistered) {
            return;
        }
        const pythonExtension = this.extensions.getExtension<{ jupyter: { registerHooks(): void } }>(PythonExtension);
        if (!pythonExtension) {
            return;
        }
        this.hooksRegistered = true;
        if (!pythonExtension.isActive) {
            await pythonExtension.activate();
            this.didActivePython.fire();
        }
        pythonExtension.exports.jupyter.registerHooks();
    }
}

@injectable()
export class PythonExtensionChecker implements IPythonExtensionChecker {
    private extensionChangeHandler: Disposable | undefined;
    private pythonExtensionId = PythonExtension;
    private waitingOnInstallPrompt?: Promise<void>;
    constructor(
        @inject(IExtensions) private readonly extensions: IExtensions,
        @inject(IPersistentStateFactory) private readonly persistentStateFactory: IPersistentStateFactory,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(ICommandManager) private readonly commandManager: ICommandManager
    ) {
        // If the python extension is not installed listen to see if anything does install it
        if (!this.isPythonExtensionInstalled) {
            this.extensionChangeHandler = this.extensions.onDidChange(this.extensionsChangeHandler.bind(this));
        }
    }

    public get isPythonExtensionInstalled() {
        return this.extensions.getExtension(this.pythonExtensionId) !== undefined;
    }
    public get isPythonExtensionActive() {
        return this.extensions.getExtension(this.pythonExtensionId)?.isActive === true;
    }

    public async showPythonExtensionInstallRequiredPrompt(): Promise<void> {
        if (this.waitingOnInstallPrompt) {
            return this.waitingOnInstallPrompt;
        }
        // Ask user if they want to install and then wait for them to actually install it.
        const yes = localize.Common.bannerLabelYes();
        const no = localize.Common.bannerLabelNo();
        const answer = await this.appShell.showErrorMessage(localize.DataScience.pythonExtensionRequired(), yes, no);
        if (answer === yes) {
            await this.installPythonExtension();
        }
    }

    public async showPythonExtensionInstallRecommendedPrompt() {
        const key = 'ShouldShowPythonExtensionInstallRecommendedPrompt';
        const surveyPrompt = this.persistentStateFactory.createGlobalPersistentState(key, true);
        if (surveyPrompt.value) {
            const yes = localize.Common.bannerLabelYes();
            const no = localize.Common.bannerLabelNo();
            const doNotShowAgain = localize.Common.doNotShowAgain();

            const promise = (this.waitingOnInstallPrompt = new Promise<void>(async (resolve) => {
                const answer = await this.appShell.showWarningMessage(
                    localize.DataScience.pythonExtensionRecommended(),
                    yes,
                    no,
                    doNotShowAgain
                );
                switch (answer) {
                    case yes:
                        await this.installPythonExtension();
                        break;
                    case doNotShowAgain:
                        await surveyPrompt.updateValue(false);
                        break;
                    default:
                        break;
                }
                resolve();
            }));
            await promise;
            this.waitingOnInstallPrompt = undefined;
        }
    }

    private async installPythonExtension() {
        // Have the user install python
        void this.commandManager.executeCommand('extension.open', PythonExtension);
    }

    private async extensionsChangeHandler(): Promise<void> {
        // On extension change see if python was installed, if so unhook our extension change watcher and
        // notify the user that they might need to restart notebooks or interactive windows
        if (this.isPythonExtensionInstalled && this.extensionChangeHandler) {
            this.extensionChangeHandler.dispose();
            this.extensionChangeHandler = undefined;

            this.appShell
                .showInformationMessage(localize.DataScience.pythonExtensionInstalled(), localize.Common.ok())
                .then(noop, noop);
        }
    }
}

@injectable()
export class LanguageServerProvider implements ILanguageServerProvider {
    constructor(@inject(IPythonApiProvider) private readonly apiProvider: IPythonApiProvider) {}

    public getLanguageServer(resource?: InterpreterUri): Promise<ILanguageServer | undefined> {
        return this.apiProvider.getApi().then((api) => api.getLanguageServer(resource));
    }
}

@injectable()
export class WindowsStoreInterpreter implements IWindowsStoreInterpreter {
    constructor(@inject(IPythonApiProvider) private readonly apiProvider: IPythonApiProvider) {}

    public isWindowsStoreInterpreter(pythonPath: string): Promise<boolean> {
        return this.apiProvider.getApi().then((api) => api.isWindowsStoreInterpreter(pythonPath));
    }
}

@injectable()
export class PythonDebuggerPathProvider implements IPythonDebuggerPathProvider {
    constructor(@inject(IPythonApiProvider) private readonly apiProvider: IPythonApiProvider) {}

    public getDebuggerPath(): Promise<string> {
        return this.apiProvider.getApi().then((api) => api.getDebuggerPath());
    }
}

const ProductMapping: { [key in Product]: JupyterProductToInstall } = {
    [Product.ipykernel]: JupyterProductToInstall.ipykernel,
    [Product.jupyter]: JupyterProductToInstall.jupyter,
    [Product.kernelspec]: JupyterProductToInstall.kernelspec,
    [Product.nbconvert]: JupyterProductToInstall.nbconvert,
    [Product.notebook]: JupyterProductToInstall.notebook,
    [Product.pandas]: JupyterProductToInstall.pandas
};

/* eslint-disable max-classes-per-file */
@injectable()
export class PythonInstaller implements IPythonInstaller {
    private readonly _onInstalled = new EventEmitter<{ product: Product; resource?: InterpreterUri }>();
    public get onInstalled(): Event<{ product: Product; resource?: InterpreterUri }> {
        return this._onInstalled.event;
    }
    constructor(@inject(IPythonApiProvider) private readonly apiProvider: IPythonApiProvider) {}

    public async install(
        product: Product,
        resource?: InterpreterUri,
        cancel?: CancellationToken
    ): Promise<InstallerResponse> {
        let action: 'installed' | 'failed' | 'disabled' | 'ignored' = 'installed';
        try {
            const api = await this.apiProvider.getApi();
            const result = await api.install(ProductMapping[product], resource, cancel);
            if (result === InstallerResponse.Installed) {
                this._onInstalled.fire({ product, resource });
            }
            switch (result) {
                case InstallerResponse.Installed:
                    action = 'installed';
                    break;
                case InstallerResponse.Ignore:
                    action = 'ignored';
                    break;
                case InstallerResponse.Disabled:
                    action = 'disabled';
                    break;
                default:
                    break;
            }
            return result;
        } catch (ex) {
            action = 'failed';
            throw ex;
        } finally {
            product;
            sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
                action,
                moduleName: ProductNames.get(product)!
            });
        }
    }
}

// eslint-disable-next-line max-classes-per-file
@injectable()
export class EnvironmentActivationService implements IEnvironmentActivationService {
    constructor(@inject(IPythonApiProvider) private readonly apiProvider: IPythonApiProvider) {}

    public async getActivatedEnvironmentVariables(
        resource: Resource,
        interpreter?: PythonEnvironment
    ): Promise<NodeJS.ProcessEnv | undefined> {
        return this.apiProvider
            .getApi()
            .then((api) => api.getActivatedEnvironmentVariables(resource, interpreter, false));
    }
}

// eslint-disable-next-line max-classes-per-file
@injectable()
export class InterpreterSelector implements IInterpreterSelector {
    constructor(@inject(IPythonApiProvider) private readonly apiProvider: IPythonApiProvider) {}

    public async getSuggestions(resource: Resource): Promise<IInterpreterQuickPickItem[]> {
        return this.apiProvider.getApi().then((api) => api.getSuggestions(resource));
    }
}
// eslint-disable-next-line max-classes-per-file
@injectable()
export class InterpreterService implements IInterpreterService {
    private readonly didChangeInterpreter = new EventEmitter<void>();
    private eventHandlerAdded?: boolean;
    constructor(
        @inject(IPythonApiProvider) private readonly apiProvider: IPythonApiProvider,
        @inject(IPythonExtensionChecker) private extensionChecker: IPythonExtensionChecker,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService
    ) {}

    public get onDidChangeInterpreter(): Event<void> {
        if (this.extensionChecker.isPythonExtensionInstalled) {
            if (this.extensionChecker.isPythonExtensionActive && this.eventHandlerAdded) {
                this.hookupOnDidChangeInterpreterEvent();
            }
            if (!this.extensionChecker.isPythonExtensionActive) {
                this.apiProvider.onDidActivePythonExtension(
                    this.hookupOnDidChangeInterpreterEvent,
                    this,
                    this.disposables
                );
            }
        }
        return this.didChangeInterpreter.event;
    }

    public getInterpreters(resource?: Uri): Promise<PythonEnvironment[]> {
        return this.apiProvider.getApi().then((api) => api.getInterpreters(resource));
    }
    private workspaceCachedActiveInterpreter = new Map<string, Promise<PythonEnvironment | undefined>>();
    public getActiveInterpreter(resource?: Uri): Promise<PythonEnvironment | undefined> {
        const workspaceId = this.workspace.getWorkspaceFolderIdentifier(resource);
        let promise = this.workspaceCachedActiveInterpreter.get(workspaceId);
        if (!promise) {
            promise = this.apiProvider.getApi().then((api) => api.getActiveInterpreter(resource));

            if (promise) {
                this.workspaceCachedActiveInterpreter.set(workspaceId, promise);
                // If there was a problem in getting the details, remove the cached info.
                promise.catch(() => {
                    if (this.workspaceCachedActiveInterpreter.get(workspaceId) === promise) {
                        this.workspaceCachedActiveInterpreter.delete(workspaceId);
                    }
                });
            }
        }
        return promise;
    }

    public async getInterpreterDetails(pythonPath: string, resource?: Uri): Promise<undefined | PythonEnvironment> {
        try {
            return await this.apiProvider.getApi().then((api) => api.getInterpreterDetails(pythonPath, resource));
        } catch {
            // If the python extension cannot get the details here, don't fail. Just don't use them.
            return undefined;
        }
    }
    private hookupOnDidChangeInterpreterEvent() {
        this.apiProvider
            .getApi()
            .then((api) => {
                if (!this.eventHandlerAdded) {
                    this.eventHandlerAdded = true;
                    api.onDidChangeInterpreter(() => this.didChangeInterpreter.fire(), this, this.disposables);
                }
            })
            .catch(noop);
    }
}
