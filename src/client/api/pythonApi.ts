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

import { inject, injectable, named } from 'inversify';
import { CancellationToken, Disposable, Event, EventEmitter, Memento, Uri, workspace } from 'vscode';
import { IApplicationShell, ICommandManager, IWorkspaceService } from '../common/application/types';
import { isCI } from '../common/constants';
import { trackPackageInstalledIntoInterpreter } from '../common/installer/productInstaller';
import { ProductNames } from '../common/installer/productNames';
import { InterpreterUri } from '../common/installer/types';
import { traceError, traceInfo, traceInfoIfCI } from '../common/logger';
import { getDisplayPath } from '../common/platform/fs-paths';
import {
    GLOBAL_MEMENTO,
    IDisposableRegistry,
    IExtensions,
    IMemento,
    InstallerResponse,
    Product,
    Resource
} from '../common/types';
import { createDeferred } from '../common/utils/async';
import * as localize from '../common/utils/localize';
import { isResource, noop } from '../common/utils/misc';
import { StopWatch } from '../common/utils/stopWatch';
import { PythonExtension, Telemetry } from '../datascience/constants';
import { InterpreterPackages } from '../datascience/telemetry/interpreterPackages';
import { IEnvironmentActivationService } from '../interpreter/activation/types';
import { IInterpreterQuickPickItem, IInterpreterSelector } from '../interpreter/configuration/types';
import { IInterpreterService } from '../interpreter/contracts';
import { IWindowsStoreInterpreter } from '../interpreter/locators/types';
import { EnvironmentType, PythonEnvironment } from '../pythonEnvironments/info';
import { areInterpreterPathsSame } from '../pythonEnvironments/info/interpreter';
import { captureTelemetry, sendTelemetryEvent } from '../telemetry';
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
    private readonly didActivatePython = new EventEmitter<void>();
    public get onDidActivatePythonExtension() {
        return this.didActivatePython.event;
    }

    private initialized?: boolean;
    private hooksRegistered?: boolean;

    constructor(
        @inject(IExtensions) private readonly extensions: IExtensions,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IPythonExtensionChecker) private extensionChecker: IPythonExtensionChecker,
        @inject(IWorkspaceService) private workspace: IWorkspaceService
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
        this.disposables.push(this.didActivatePython);
    }

    public getApi(): Promise<PythonApi> {
        this.init().catch(noop);
        return this.api.promise;
    }

    public setApi(api: PythonApi): void {
        // Never allow accessing python API (we dont want to ever use the API and run code in untrusted API).
        // Don't assume Python API will always be disabled in untrusted worksapces.
        if (this.api.resolved || !this.workspace.isTrusted) {
            return;
        }
        this.api.resolve(api);

        // Log experiment status here. Python extension is definitely loaded at this point.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pythonConfig = workspace.getConfiguration('python', (null as any) as Uri);
        const experimentsSection = pythonConfig.get('experiments');
        traceInfo(`Experiment status for python is ${JSON.stringify(experimentsSection)}`);
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
            this.didActivatePython.fire();
        }
        pythonExtension.exports.jupyter.registerHooks();
    }
}

@injectable()
export class PythonExtensionChecker implements IPythonExtensionChecker {
    private extensionChangeHandler: Disposable | undefined;
    private waitingOnInstallPrompt?: Promise<void>;
    constructor(
        @inject(IExtensions) private readonly extensions: IExtensions,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService
    ) {
        // If the python extension is not installed listen to see if anything does install it
        if (!this.isPythonExtensionInstalled) {
            this.extensionChangeHandler = this.extensions.onDidChange(this.extensionsChangeHandler.bind(this));
        }
    }

    public get isPythonExtensionInstalled() {
        return this.extensions.getExtension(PythonExtension) !== undefined;
    }
    public get isPythonExtensionActive() {
        return this.extensions.getExtension(PythonExtension)?.isActive === true;
    }

    public async showPythonExtensionInstallRequiredPrompt(): Promise<void> {
        // If workspace is not trusted, then don't show prompt
        if (!this.workspace.isTrusted) {
            return;
        }
        if (this.waitingOnInstallPrompt) {
            return this.waitingOnInstallPrompt;
        }
        // Ask user if they want to install and then wait for them to actually install it.
        const yes = localize.Common.bannerLabelYes();
        const no = localize.Common.bannerLabelNo();
        sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'displayed' });
        const answer = await this.appShell.showErrorMessage(localize.DataScience.pythonExtensionRequired(), yes, no);
        if (answer === yes) {
            sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'download' });
            await this.installPythonExtension();
        } else {
            sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'dismissed' });
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
    [Product.pandas]: JupyterProductToInstall.pandas,
    [Product.pip]: JupyterProductToInstall.pip
};

/* eslint-disable max-classes-per-file */
@injectable()
export class PythonInstaller implements IPythonInstaller {
    private readonly _onInstalled = new EventEmitter<{ product: Product; resource?: InterpreterUri }>();
    public get onInstalled(): Event<{ product: Product; resource?: InterpreterUri }> {
        return this._onInstalled.event;
    }
    constructor(
        @inject(IPythonApiProvider) private readonly apiProvider: IPythonApiProvider,
        @inject(InterpreterPackages) private readonly interpreterPackages: InterpreterPackages,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly memento: Memento
    ) {}

    public async install(
        product: Product,
        resource?: InterpreterUri,
        cancel?: CancellationToken,
        reInstallAndUpdate?: boolean,
        installPipIfRequired?: boolean
    ): Promise<InstallerResponse> {
        if (resource && !isResource(resource)) {
            this.interpreterPackages.trackPackages(resource);
        }
        let action: 'installed' | 'failed' | 'disabled' | 'ignored' = 'installed';
        try {
            const api = await this.apiProvider.getApi();
            const result = await api.install(
                ProductMapping[product],
                resource,
                cancel,
                reInstallAndUpdate,
                installPipIfRequired
            );
            trackPackageInstalledIntoInterpreter(this.memento, product, resource).catch(noop);
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
        const stopWatch = new StopWatch();
        const env = await this.apiProvider
            .getApi()
            .then((api) => api.getActivatedEnvironmentVariables(resource, interpreter, false));

        const envType = interpreter?.envType;
        sendTelemetryEvent(Telemetry.GetActivatedEnvironmentVariables, stopWatch.elapsedTime, {
            envType,
            failed: Object.keys(env || {}).length === 0
        });
        // We must get actiavted env variables for Conda env, if not running stuff against conda will not work.
        // Hence we must log these as errors (so we can see them in jupyter logs).
        if (envType === EnvironmentType.Conda) {
            traceError(`Failed to get activated conda env variables for ${interpreter?.envName}: ${interpreter?.path}`);
        }
        return env;
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
    private readonly didChangeInterpreters = new EventEmitter<void>();
    private eventHandlerAdded?: boolean;
    private interpreterListCachePromise: Promise<PythonEnvironment[]> | undefined = undefined;
    constructor(
        @inject(IPythonApiProvider) private readonly apiProvider: IPythonApiProvider,
        @inject(IPythonExtensionChecker) private extensionChecker: IPythonExtensionChecker,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IWorkspaceService) private workspace: IWorkspaceService
    ) {
        if (this.extensionChecker.isPythonExtensionInstalled) {
            if (!this.extensionChecker.isPythonExtensionActive) {
                // This event may not fire. It only fires if we're the reason for python extension
                // activation. VS code does not fire such an event itself if something else activates
                this.apiProvider.onDidActivatePythonExtension(
                    this.hookupOnDidChangeInterpreterEvent,
                    this,
                    this.disposables
                );
            }
        }
        this.workspace.onDidChangeWorkspaceFolders(this.onDidChangeWorkspaceFolders, this, disposables);
    }

    public get onDidChangeInterpreter(): Event<void> {
        this.hookupOnDidChangeInterpreterEvent();
        return this.didChangeInterpreter.event;
    }

    public get onDidChangeInterpreters(): Event<void> {
        this.hookupOnDidChangeInterpreterEvent();
        return this.didChangeInterpreters.event;
    }

    @captureTelemetry(Telemetry.InterpreterListingPerf)
    public getInterpreters(resource?: Uri): Promise<PythonEnvironment[]> {
        this.hookupOnDidChangeInterpreterEvent();
        // Cache result as it only changes when the interpreter list changes or we add more workspace folders
        if (!this.interpreterListCachePromise) {
            this.interpreterListCachePromise = this.getInterpretersImpl(resource);
        }
        return this.interpreterListCachePromise;
    }

    private workspaceCachedActiveInterpreter = new Map<string, Promise<PythonEnvironment | undefined>>();
    @captureTelemetry(Telemetry.ActiveInterpreterListingPerf)
    public getActiveInterpreter(resource?: Uri): Promise<PythonEnvironment | undefined> {
        this.hookupOnDidChangeInterpreterEvent();
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
                if (isCI) {
                    promise
                        .then((item) =>
                            traceInfo(
                                `Active Interpreter in Python API for ${resource?.toString()} is ${getDisplayPath(
                                    item?.path
                                )}`
                            )
                        )
                        .catch(noop);
                }
            }
        }
        return promise;
    }

    public async getInterpreterDetails(pythonPath: string, resource?: Uri): Promise<undefined | PythonEnvironment> {
        this.hookupOnDidChangeInterpreterEvent();
        try {
            return await this.apiProvider.getApi().then((api) => api.getInterpreterDetails(pythonPath, resource));
        } catch {
            // If the python extension cannot get the details here, don't fail. Just don't use them.
            return undefined;
        }
    }

    private onDidChangeWorkspaceFolders() {
        this.interpreterListCachePromise = undefined;
    }
    private async getInterpretersImpl(resource?: Uri): Promise<PythonEnvironment[]> {
        // Python uses the resource to look up the workspace folder. For Jupyter
        // we want all interpreters regardless of workspace folder so call this multiple times
        const folders = this.workspace.workspaceFolders;
        const all = folders
            ? await Promise.all(folders.map((f) => this.apiProvider.getApi().then((api) => api.getInterpreters(f.uri))))
            : await Promise.all([this.apiProvider.getApi().then((api) => api.getInterpreters(undefined))]);

        // Remove dupes
        const result: PythonEnvironment[] = [];
        all.flat().forEach((p) => {
            if (!result.find((r) => areInterpreterPathsSame(r.path, p.path))) {
                result.push(p);
            }
        });
        traceInfoIfCI(`Interpreter list for ${resource?.toString()} is ${result.map((i) => i.path).join('\n')}`);
        return result;
    }

    private hookupOnDidChangeInterpreterEvent() {
        // Only do this once.
        if (this.eventHandlerAdded) {
            return;
        }
        // Python may not be installed or active
        if (!this.extensionChecker.isPythonExtensionInstalled) {
            return;
        }
        if (!this.extensionChecker.isPythonExtensionActive) {
            return;
        }
        this.apiProvider
            .getApi()
            .then((api) => {
                if (!this.eventHandlerAdded) {
                    this.eventHandlerAdded = true;
                    api.onDidChangeInterpreter(
                        () => {
                            this.interpreterListCachePromise = undefined;
                            this.workspaceCachedActiveInterpreter.clear();
                            this.didChangeInterpreter.fire();
                        },
                        this,
                        this.disposables
                    );
                    api.onDidChangeInterpreters(
                        () => {
                            this.interpreterListCachePromise = undefined;
                            this.didChangeInterpreters.fire();
                        },
                        this,
                        this.disposables
                    );
                }
            })
            .catch(noop);
    }
}
