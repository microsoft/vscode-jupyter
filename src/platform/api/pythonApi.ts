// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { EventEmitter, Event, Uri, workspace, ExtensionMode } from 'vscode';
import {
    IPythonApiProvider,
    IPythonExtensionChecker,
    IPythonProposedApi,
    PythonApi,
    PythonEnvironment_PythonApi,
    RefreshInterpretersOptions
} from './types';
import * as localize from '../common/utils/localize';
import { injectable, inject } from 'inversify';
import { captureTelemetry, sendTelemetryEvent, sendTelemetryWhenDone } from '../../telemetry';
import { IWorkspaceService, IApplicationShell, ICommandManager } from '../common/application/types';
import { isCI, PythonExtension, Telemetry } from '../common/constants';
import { IExtensions, IDisposableRegistry, Resource, IExtensionContext } from '../common/types';
import { createDeferred } from '../common/utils/async';
import { traceDecoratorVerbose, traceError, traceInfo, traceVerbose } from '../logging';
import { getDisplayPath, getFilePath } from '../common/platform/fs-paths';
import { IInterpreterSelector, IInterpreterQuickPickItem } from '../interpreter/configuration/types';
import { IInterpreterService } from '../interpreter/contracts';
import { areInterpreterPathsSame } from '../pythonEnvironments/info/interpreter';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { TraceOptions } from '../logging/types';
import { noop } from '../common/utils/misc';

export function deserializePythonEnvironment(
    pythonVersion: Partial<PythonEnvironment_PythonApi> | undefined
): PythonEnvironment | undefined {
    if (pythonVersion) {
        const result = {
            ...pythonVersion,
            sysPrefix: pythonVersion.sysPrefix || '',
            uri: Uri.file(pythonVersion.path || ''),
            envPath: pythonVersion.envPath ? Uri.file(pythonVersion.envPath) : undefined
        };

        // Cleanup stuff that shouldn't be there.
        delete result.path;
        if (!pythonVersion.envPath) {
            delete result.envPath;
        }
        return result;
    }
}

export function serializePythonEnvironment(
    jupyterVersion: PythonEnvironment | undefined
): PythonEnvironment_PythonApi | undefined {
    if (jupyterVersion) {
        const result = {
            ...jupyterVersion,
            path: getFilePath(jupyterVersion.uri),
            envPath: jupyterVersion.envPath ? getFilePath(jupyterVersion.envPath) : undefined
        };
        // Cleanup stuff that shouldn't be there.
        delete (result as any).uri;
        return result;
    }
}

/* eslint-disable max-classes-per-file */
@injectable()
export class PythonApiProvider implements IPythonApiProvider {
    private readonly api = createDeferred<PythonApi>();
    private readonly didActivatePython = new EventEmitter<void>();
    private readonly _pythonExtensionHooked = createDeferred<void>();
    public get onDidActivatePythonExtension() {
        return this.didActivatePython.event;
    }

    // This promise will resolve when the python extension is hooked
    public get pythonExtensionHooked(): Promise<void> {
        return this._pythonExtensionHooked.promise;
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
        const pythonProposedApi = this.extensions.getExtension<IPythonProposedApi>(PythonExtension)!.exports;
        // Merge the python proposed API into our Jupyter specific API.
        // This way we deal with a single API instead of two.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const unifiedApi: PythonApi = {} as any;
        Object.assign(unifiedApi, pythonProposedApi.environment);
        Object.assign(unifiedApi, api);

        // Workaround API name changes (only used in test code at the moment)
        if (!unifiedApi.refreshInterpreters && (unifiedApi as any).refreshEnvironment) {
            unifiedApi.refreshInterpreters = (options: RefreshInterpretersOptions) => {
                return (unifiedApi as any).refreshEnvironment(options);
            };
            unifiedApi.setActiveInterpreter = (path: string, resource?: Resource) => {
                return (unifiedApi as any).setActiveEnvironment(path, resource);
            };
        }

        this.api.resolve(unifiedApi);

        // Log experiment status here. Python extension is definitely loaded at this point.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pythonConfig = workspace.getConfiguration('python', null as any as Uri);
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
            try {
                await pythonExtension.activate();
                this.didActivatePython.fire();
            } catch (ex) {
                traceError(`Failed activating the python extension: `, ex);
                this.api.reject(ex);
                return;
            }
        }
        pythonExtension.exports.jupyter.registerHooks();
        this._pythonExtensionHooked.resolve();
    }
}

@injectable()
export class PythonExtensionChecker implements IPythonExtensionChecker {
    private previousInstallState: boolean;
    private readonly pythonExtensionInstallationStatusChanged = new EventEmitter<'installed' | 'uninstalled'>();
    public get onPythonExtensionInstallationStatusChanged() {
        return this.pythonExtensionInstallationStatusChanged.event;
    }
    /**
     * Used only for testsing
     */
    public static promptDisplayed?: boolean;
    constructor(
        @inject(IExtensions) private readonly extensions: IExtensions,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry
    ) {
        // Listen for the python extension being installed or uninstalled
        this.extensions.onDidChange(this.extensionsChangeHandler.bind(this), this, this.disposables);

        // Name is a bit different here as we use the isPythonExtensionInstalled property for checking the current state.
        // This property is to see if we change it during extension actions.
        this.previousInstallState = this.isPythonExtensionInstalled;
    }

    public get isPythonExtensionInstalled() {
        return this.extensions.getExtension(PythonExtension) !== undefined;
    }
    public get isPythonExtensionActive() {
        return this.extensions.getExtension(PythonExtension)?.isActive === true;
    }

    // Directly install the python extension instead of just showing the extension open page
    public async directlyInstallPythonExtension(): Promise<void> {
        return this.commandManager.executeCommand('workbench.extensions.installExtension', PythonExtension, {
            context: { skipWalkthrough: true }
        });
    }

    // Notify the user that Python is require, and open up the Extension installation page to the
    // python extension
    public async showPythonExtensionInstallRequiredPrompt(): Promise<void> {
        // If workspace is not trusted, then don't show prompt
        if (!this.workspace.isTrusted) {
            return;
        }

        PythonExtensionChecker.promptDisplayed = true;
        // Ask user if they want to install and then wait for them to actually install it.
        const yes = localize.Common.bannerLabelYes();
        sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'displayed' });
        const answer = await this.appShell.showInformationMessage(
            localize.DataScience.pythonExtensionRequired(),
            { modal: true },
            yes
        );
        if (answer === yes) {
            sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'download' });
            await this.installPythonExtension();
        } else {
            sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'dismissed' });
        }
    }
    private async installPythonExtension() {
        // Have the user install python
        this.commandManager.executeCommand('extension.open', PythonExtension).then(noop, noop);
    }

    private async extensionsChangeHandler(): Promise<void> {
        // Check to see if we changed states, if so signal
        const newInstallState = this.isPythonExtensionInstalled;

        if (newInstallState !== this.previousInstallState) {
            this.pythonExtensionInstallationStatusChanged.fire(newInstallState ? 'installed' : 'uninstalled');
            this.previousInstallState = newInstallState;
        }
    }
}

// eslint-disable-next-line max-classes-per-file
@injectable()
export class InterpreterSelector implements IInterpreterSelector {
    constructor(@inject(IPythonApiProvider) private readonly apiProvider: IPythonApiProvider) {}

    public async getSuggestions(resource: Resource): Promise<IInterpreterQuickPickItem[]> {
        const api = await this.apiProvider.getApi();

        let suggestions =
            'getKnownSuggestions' in api ? api.getKnownSuggestions(resource) : await api.getSuggestions(resource);

        const deserializedSuggestions: IInterpreterQuickPickItem[] = [];
        suggestions.forEach((item) => {
            const interpreter = deserializePythonEnvironment(item.interpreter);
            if (interpreter) {
                deserializedSuggestions.push({ ...item, interpreter: interpreter });
            }
        });
        return deserializedSuggestions;
    }
}

// eslint-disable-next-line max-classes-per-file
@injectable()
export class InterpreterService implements IInterpreterService {
    private readonly didChangeInterpreter = new EventEmitter<void>();
    private readonly didChangeInterpreters = new EventEmitter<void>();
    private eventHandlerAdded?: boolean;
    private interpreterListCachePromise: Promise<PythonEnvironment[]> | undefined = undefined;
    private canFindRefreshPromise: boolean | undefined = undefined;
    private refreshPromise: Promise<void> | undefined = undefined;
    private api: PythonApi | undefined;
    private apiPromise: Promise<PythonApi> | undefined;
    private interpretersFetchedOnceBefore?: boolean;
    constructor(
        @inject(IPythonApiProvider) private readonly apiProvider: IPythonApiProvider,
        @inject(IPythonExtensionChecker) private extensionChecker: IPythonExtensionChecker,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(IExtensionContext) private readonly context: IExtensionContext
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

    public get refreshing() {
        const refreshPromise = this.getRefreshPromise();
        return refreshPromise !== undefined;
    }

    public get onDidChangeInterpreter(): Event<void> {
        this.hookupOnDidChangeInterpreterEvent();
        return this.didChangeInterpreter.event;
    }

    public get onDidChangeInterpreters(): Event<void> {
        this.hookupOnDidChangeInterpreterEvent();
        return this.didChangeInterpreters.event;
    }

    @traceDecoratorVerbose('Get Interpreters', TraceOptions.Arguments | TraceOptions.BeforeCall)
    public getInterpreters(resource?: Uri): Promise<PythonEnvironment[]> {
        this.hookupOnDidChangeInterpreterEvent();
        // Cache result as it only changes when the interpreter list changes or we add more workspace folders
        const firstTime = !!this.interpretersFetchedOnceBefore;
        this.interpretersFetchedOnceBefore = true;
        if (!this.interpreterListCachePromise) {
            this.interpreterListCachePromise = this.getInterpretersImpl(resource);
        }
        sendTelemetryWhenDone(Telemetry.InterpreterListingPerf, this.interpreterListCachePromise, undefined, {
            firstTime
        });
        return this.interpreterListCachePromise;
    }

    public async refreshInterpreters() {
        const api = await this.getApi();
        try {
            if (api?.refreshInterpreters) {
                const newItems = await api.refreshInterpreters({ clearCache: false });
                this.interpreterListCachePromise = undefined;
                this.didChangeInterpreters.fire();
                traceVerbose(`Refreshed Environments and got ${newItems}`);
            } else if ((api as any).refreshEnvironment) {
                const newItems = await (api as any).refreshEnvironment({ clearCache: false });
                this.interpreterListCachePromise = undefined;
                this.didChangeInterpreters.fire();
                traceVerbose(`Refreshed Environments and got ${newItems}`);
            }
        } catch (ex) {
            traceError(`Failed to refresh the list of interpreters`);
        }
    }
    private workspaceCachedActiveInterpreter = new Map<string, Promise<PythonEnvironment | undefined>>();
    @captureTelemetry(Telemetry.ActiveInterpreterListingPerf)
    @traceDecoratorVerbose('Get Active Interpreter', TraceOptions.Arguments | TraceOptions.BeforeCall)
    public getActiveInterpreter(resource?: Uri): Promise<PythonEnvironment | undefined> {
        this.hookupOnDidChangeInterpreterEvent();
        const workspaceId = this.workspace.getWorkspaceFolderIdentifier(resource);
        let promise = this.workspaceCachedActiveInterpreter.get(workspaceId);
        if (!promise) {
            promise = this.getApi()
                .then((api) => api?.getActiveInterpreter(resource))
                .then(deserializePythonEnvironment);

            if (promise) {
                this.workspaceCachedActiveInterpreter.set(workspaceId, promise);
                // If there was a problem in getting the details, remove the cached info.
                promise.catch(() => {
                    if (this.workspaceCachedActiveInterpreter.get(workspaceId) === promise) {
                        this.workspaceCachedActiveInterpreter.delete(workspaceId);
                    }
                });
                if (isCI || [ExtensionMode.Development, ExtensionMode.Test].includes(this.context.extensionMode)) {
                    promise
                        .then((item) =>
                            traceInfo(
                                `Active Interpreter in Python API for resource '${getDisplayPath(
                                    resource
                                )}' is ${getDisplayPath(item?.uri)}, EnvType: ${item?.envType}, EnvName: '${
                                    item?.envName
                                }', Version: ${item?.version?.raw}`
                            )
                        )
                        .catch(noop);
                }
            }
        }
        return promise;
    }

    @traceDecoratorVerbose('Get Interpreter details', TraceOptions.Arguments | TraceOptions.BeforeCall)
    public async getInterpreterDetails(pythonPath: Uri, resource?: Uri): Promise<undefined | PythonEnvironment> {
        this.hookupOnDidChangeInterpreterEvent();
        try {
            return await this.getApi()
                .then((api) => api?.getInterpreterDetails(getFilePath(pythonPath), resource))
                .then(deserializePythonEnvironment);
        } catch {
            // If the python extension cannot get the details here, don't fail. Just don't use them.
            return undefined;
        }
    }

    private async getApi(): Promise<PythonApi | undefined> {
        if (!this.extensionChecker.isPythonExtensionInstalled) {
            return;
        }
        if (!this.apiPromise) {
            this.apiPromise = this.apiProvider.getApi().then((a) => (this.api = a));
        }
        return this.apiPromise;
    }

    private tryGetApi(): PythonApi | undefined {
        if (!this.apiPromise) {
            this.getApi().ignoreErrors();
        }
        return this.api;
    }

    private onDidChangeWorkspaceFolders() {
        this.interpreterListCachePromise = undefined;
    }
    private async getInterpretersImpl(resource?: Uri): Promise<PythonEnvironment[]> {
        // Python uses the resource to look up the workspace folder. For Jupyter
        // we want all interpreters regardless of workspace folder so call this multiple times
        const folders = this.workspace.workspaceFolders;
        const activeInterpreterPromise = this.getActiveInterpreter(resource);
        const all = folders
            ? await Promise.all(
                  [...folders, undefined].map((f) => this.getApi().then((api) => api?.getInterpreters(f?.uri)))
              )
            : await Promise.all([await this.getApi().then((api) => api?.getInterpreters(undefined))]);
        const activeInterpreter = await activeInterpreterPromise;
        // Remove dupes
        const result: PythonEnvironment[] = [];
        const allInterpreters = [...all.flat()]
            .map(deserializePythonEnvironment)
            .filter((item) => !!item) as PythonEnvironment[];
        if (activeInterpreter) {
            allInterpreters.push(activeInterpreter);
        }
        traceVerbose(
            `Full interpreter list for ${getDisplayPath(resource)} is length: ${
                allInterpreters.length
            }, ${allInterpreters
                .map((item) => `${item.displayName}:${item.envType}:${getDisplayPath(item.uri)}`)
                .join(', ')}`
        );
        allInterpreters.forEach((interpreter) => {
            if (interpreter && !result.find((r) => areInterpreterPathsSame(r.uri, interpreter.uri))) {
                result.push(interpreter);
            }
        });
        return result;
    }

    private hookupOnDidChangeInterpreterEvent() {
        // Only do this once.
        if (this.eventHandlerAdded) {
            return;
        }
        this.getApi()
            .then((api) => {
                if (!this.eventHandlerAdded && api) {
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
    private getRefreshPromise(): Promise<void> | undefined {
        if (this.canFindRefreshPromise === undefined) {
            this.canFindRefreshPromise = false;
            const api = this.tryGetApi();
            if (!api) {
                this.getApi()
                    .then((a) => {
                        this.canFindRefreshPromise = a?.getRefreshPromise !== undefined;
                    })
                    .ignoreErrors();
            } else {
                this.canFindRefreshPromise = api.getRefreshPromise !== undefined;
            }
        }
        if (!this.canFindRefreshPromise) {
            return undefined; // If API isn't supported, then just assume we're not in the middle of a refresh.
        } else {
            const api = this.tryGetApi();
            const apiRefreshPromise = api?.getRefreshPromise ? api.getRefreshPromise() : undefined;
            if (apiRefreshPromise != this.refreshPromise) {
                this.refreshPromise = apiRefreshPromise;
                // When we first capture the refresh promise, make sure it fires an event to
                // refresh when done.
                this.refreshPromise?.then(() => this.didChangeInterpreters.fire()).ignoreErrors;
            }
            return this.refreshPromise;
        }
    }
}
