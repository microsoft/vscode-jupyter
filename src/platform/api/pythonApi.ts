// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { EventEmitter, Event, Uri, ExtensionMode, CancellationTokenSource, CancellationToken } from 'vscode';
import {
    IPythonApiProvider,
    IPythonExtensionChecker,
    PythonApi,
    PythonEnvironmentV2,
    PythonEnvironment_PythonApi
} from './types';
import * as localize from '../common/utils/localize';
import { injectable, inject } from 'inversify';
import { sendTelemetryEvent } from '../../telemetry';
import { IWorkspaceService, IApplicationShell, ICommandManager } from '../common/application/types';
import { isCI, PythonExtension, Telemetry } from '../common/constants';
import { IExtensions, IDisposableRegistry, Resource, IExtensionContext } from '../common/types';
import { createDeferred } from '../common/utils/async';
import { traceDecoratorVerbose, traceError, traceInfo, traceVerbose, traceWarning } from '../logging';
import { getDisplayPath, getFilePath } from '../common/platform/fs-paths';
import { IInterpreterSelector, IInterpreterQuickPickItem } from '../interpreter/configuration/types';
import { IInterpreterService } from '../interpreter/contracts';
import { areInterpreterPathsSame } from '../pythonEnvironments/info/interpreter';
import { EnvironmentType, PythonEnvironment } from '../pythonEnvironments/info';
import { TraceOptions } from '../logging/types';
import { areObjectsWithUrisTheSame, isUri, noop } from '../common/utils/misc';
import { StopWatch } from '../common/utils/stopWatch';
import { KnownEnvironmentTools, ProposedExtensionAPI, ResolvedEnvironment } from './pythonApiTypes';

export function deserializePythonEnvironment(
    pythonVersion: Partial<PythonEnvironment_PythonApi> | undefined,
    pythonEnvId: string
): PythonEnvironment | undefined {
    if (pythonVersion) {
        const result = {
            ...pythonVersion,
            sysPrefix: pythonVersion.sysPrefix || '',
            uri: Uri.file(pythonVersion.path || ''),
            id: pythonEnvId || (pythonVersion as any).id,
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
export function pythonEnvToJupyterEnv(env: ResolvedEnvironment): PythonEnvironment {
    const envTools = env.tools as KnownEnvironmentTools[];
    // Map the Python env tool to a Jupyter environment type.
    const orderOrEnvs: [pythonEnvTool: KnownEnvironmentTools, JupyterEnv: EnvironmentType][] = [
        ['Conda', EnvironmentType.Conda],
        ['Pyenv', EnvironmentType.Pyenv],
        ['Pipenv', EnvironmentType.Pipenv],
        ['Poetry', EnvironmentType.Poetry],
        ['VirtualEnvWrapper', EnvironmentType.VirtualEnvWrapper],
        ['VirtualEnv', EnvironmentType.VirtualEnv],
        ['Venv', EnvironmentType.Venv]
    ];
    let envType = envTools.length ? (envTools[0] as EnvironmentType) : EnvironmentType.Unknown;
    if (env.environment?.type === 'Conda') {
        envType = EnvironmentType.Conda;
    } else {
        for (const [pythonEnvTool, JupyterEnv] of orderOrEnvs) {
            if (envTools.includes(pythonEnvTool)) {
                envType = JupyterEnv;
                break;
            }
        }
        if (envType === EnvironmentType.Unknown && env.environment?.type === 'VirtualEnvironment') {
            envType = EnvironmentType.VirtualEnv;
        }
    }
    return {
        id: env.id,
        sysPrefix: env.executable.sysPrefix || '',
        envPath: Uri.file(env.path),
        envName: env.environment?.name || '',
        uri: env.executable.uri!,
        displayName: env.environment?.name || '',
        envType,
        version: env.version
            ? {
                  major: env.version.major,
                  minor: env.version.minor,
                  patch: env.version.micro,
                  raw: env.version.sysVersion
              }
            : undefined
    };
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
    public async getNewApi(): Promise<ProposedExtensionAPI | undefined> {
        await this.init();
        return this.extensions.getExtension<ProposedExtensionAPI>(PythonExtension)?.exports;
    }

    public setApi(api: PythonApi): void {
        // Never allow accessing python API (we don't want to ever use the API and run code in untrusted API).
        // Don't assume Python API will always be disabled in untrusted workspaces.
        if (this.api.resolved || !this.workspace.isTrusted) {
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
     * Used only for testing
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
        const [api, newApi] = await Promise.all([this.apiProvider.getApi(), this.apiProvider.getNewApi()]);

        let suggestions = api.getKnownSuggestions
            ? api.getKnownSuggestions(resource)
            : await api.getSuggestions(resource);

        const deserializedSuggestions: IInterpreterQuickPickItem[] = [];
        await Promise.all(
            suggestions.map(async (item) => {
                const env = await newApi!.environments.resolveEnvironment(item.interpreter.path);
                if (!env) {
                    return;
                }
                const interpreter = deserializePythonEnvironment(item.interpreter, env?.id);
                if (interpreter) {
                    deserializedSuggestions.push({ ...item, interpreter: interpreter });
                }
            })
        );
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
    private apiPromise: Promise<ProposedExtensionAPI | undefined> | undefined;
    private api?: ProposedExtensionAPI;
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
                    () => {
                        this.builtListOfInterpretersAtLeastOnce = false;
                        this.hookupOnDidChangeInterpreterEvent();
                        this.buildListOfInterpretersForFirstTime();
                    },
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
    private readonly _interpreters = new Map<string, { resolved: PythonEnvironment }>();
    public get resolvedEnvironments(): PythonEnvironment[] {
        this.hookupOnDidChangeInterpreterEvent();
        return Array.from(this._interpreters.values()).map((item) => item.resolved);
    }
    public get environments(): readonly PythonEnvironmentV2[] {
        this.getApi().catch(noop);
        this.hookupOnDidChangeInterpreterEvent();
        return (this.api?.environments?.known || []).filter((item) => this.isValidWorkSpaceRelatedEnvironment(item));
    }
    private getInterpretersCancellation?: CancellationTokenSource;
    private getInterpreters(): Promise<PythonEnvironment[]> {
        this.hookupOnDidChangeInterpreterEvent();
        // Cache result as it only changes when the interpreter list changes or we add more workspace folders
        if (!this.interpreterListCachePromise) {
            this.getInterpretersCancellation?.cancel();
            this.getInterpretersCancellation?.dispose();
            const cancellation = (this.getInterpretersCancellation = new CancellationTokenSource());
            this.interpreterListCachePromise = this.getInterpretersImpl(cancellation.token);
            this.interpreterListCachePromise.finally(() => cancellation.dispose);
        }
        return this.interpreterListCachePromise;
    }

    public async refreshInterpreters(forceRefresh: boolean = false) {
        const api = await this.getApi();
        if (!api) {
            return;
        }
        try {
            await api.environments.refreshEnvironments({ forceRefresh });
            this.interpreterListCachePromise = undefined;
            this.didChangeInterpreters.fire();
            traceVerbose(`Refreshed Environments`);
        } catch (ex) {
            traceError(`Failed to refresh the list of interpreters`);
        }
    }
    private workspaceCachedActiveInterpreter = new Set<string>();
    @traceDecoratorVerbose(
        'Get Active Interpreter',
        TraceOptions.Arguments | TraceOptions.BeforeCall | TraceOptions.ReturnValue
    )
    public async getActiveInterpreter(resource?: Uri): Promise<PythonEnvironment | undefined> {
        const stopWatch = new StopWatch();
        this.hookupOnDidChangeInterpreterEvent();
        // If there's only one workspace folder, and we don't have a resource, then use the
        // workspace uri of the single workspace folder.
        if (!resource && this.workspace.workspaceFolders?.length === 1) {
            resource = this.workspace.workspaceFolders[0].uri;
        }
        // We need a valid resource, thats associated with a workspace folder
        if (this.workspace.workspaceFolders?.length) {
            resource = this.workspace.getWorkspaceFolder(resource)?.uri || this.workspace.workspaceFolders[0].uri;
        }
        const workspaceId = this.workspace.getWorkspaceFolderIdentifier(resource);
        const promise = this.getApi().then(async (api) => {
            if (!api) {
                return;
            }
            const envPath = api.environments.getActiveEnvironmentPath(resource);
            const env = await api.environments.resolveEnvironment(envPath);
            return this.trackResolvedEnvironment(env);
        });

        // If there was a problem in getting the details, remove the cached info.
        promise
            .then(() => {
                if (!this.workspaceCachedActiveInterpreter.has(workspaceId)) {
                    this.workspaceCachedActiveInterpreter.add(workspaceId);
                    sendTelemetryEvent(
                        Telemetry.ActiveInterpreterListingPerf,
                        { duration: stopWatch.elapsedTime },
                        { firstTime: true }
                    );
                }
            })
            .catch((ex) => {
                traceWarning(`Failed to get active interpreter from Python for workspace ${workspaceId}`, ex);
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
        return promise;
    }

    @traceDecoratorVerbose('Get Interpreter details', TraceOptions.Arguments | TraceOptions.BeforeCall)
    public async getInterpreterDetails(pythonPathOrPythonId: Uri | string): Promise<undefined | PythonEnvironment> {
        this.hookupOnDidChangeInterpreterEvent();
        try {
            return await this.getApi().then(async (api) => {
                if (!api) {
                    return;
                }
                if (isUri(pythonPathOrPythonId)) {
                    // Find the Env with the same Uri.
                    const matchedPythonEnv = api.environments.known.find((item) => {
                        return areInterpreterPathsSame(item.executable.uri, pythonPathOrPythonId);
                    });
                    if (matchedPythonEnv) {
                        const env = await api.environments.resolveEnvironment(matchedPythonEnv.id);
                        return this.trackResolvedEnvironment(env);
                    }
                } else {
                    const env = await api.environments.resolveEnvironment(pythonPathOrPythonId);
                    return this.trackResolvedEnvironment(env);
                }
            });
        } catch (ex) {
            traceWarning(
                `Failed to get Python interpreter details from Python Extension API for ${
                    typeof pythonPathOrPythonId === 'string'
                        ? pythonPathOrPythonId
                        : getDisplayPath(pythonPathOrPythonId)
                }`,
                ex
            );
            // If the python extension cannot get the details here, don't fail. Just don't use them.
            return undefined;
        }
    }
    private trackResolvedEnvironment(env?: ResolvedEnvironment) {
        if (env) {
            const resolved = pythonEnvToJupyterEnv(env);
            let changed = false;
            if (
                !this._interpreters.get(env.id) ||
                !areObjectsWithUrisTheSame(resolved, this._interpreters.get(env.id)?.resolved)
            ) {
                changed = true;
                this._interpreters.set(env.id, { resolved });
            }
            if (changed) {
                this.didChangeInterpreters.fire();
            }
            return resolved;
        }
    }
    private async getApi(): Promise<ProposedExtensionAPI | undefined> {
        if (!this.extensionChecker.isPythonExtensionInstalled) {
            return;
        }
        if (!this.apiPromise) {
            this.apiPromise = this.apiProvider.getNewApi();
            this.apiPromise.then((api) => (api ? (this.api = api) : undefined)).catch(noop);
        }
        return this.apiPromise;
    }

    private onDidChangeWorkspaceFolders() {
        this.interpreterListCachePromise = undefined;
    }
    private populateCachedListOfInterpreters() {
        this.getInterpreters().ignoreErrors();
    }
    private async getInterpretersImpl(cancelToken: CancellationToken): Promise<PythonEnvironment[]> {
        if (this.extensionChecker.isPythonExtensionInstalled) {
            this.builtListOfInterpretersAtLeastOnce = true;
        }

        const allInterpreters: PythonEnvironment[] = [];
        await this.getApi().then(async (api) => {
            if (!api || cancelToken.isCancellationRequested) {
                return [];
            }
            try {
                await api.environments.refreshEnvironments();
                if (cancelToken.isCancellationRequested) {
                    return;
                }
                traceVerbose(
                    `Full interpreter list after refreshing is length: ${
                        api.environments.known.length
                    }, ${api.environments.known
                        .map(
                            (item) =>
                                `${item.id}:${item.environment?.name}:${item.tools.join(',')}:${getDisplayPath(
                                    item.executable.uri
                                )}:${item.path}`
                        )
                        .join(', ')}`
                );
                await Promise.all(
                    api.environments.known
                        .filter((item) => this.isValidWorkSpaceRelatedEnvironment(item))
                        .map(async (item) => {
                            try {
                                const env = await api.environments.resolveEnvironment(item.id);
                                const resolved = this.trackResolvedEnvironment(env);
                                traceVerbose(
                                    `Python environment ${env?.id} from Python Extension API is ${JSON.stringify(
                                        env
                                    )} and translated is ${JSON.stringify(resolved)}`
                                );
                                if (!this.isValidWorkSpaceRelatedEnvironment(item)) {
                                    return;
                                }
                                if (resolved) {
                                    allInterpreters.push(resolved);
                                } else {
                                    traceError(
                                        `Failed to get env details from Python API for ${item.id} without an error`
                                    );
                                }
                            } catch (ex) {
                                traceError(`Failed to get env details from Python API for ${item.id}`, ex);
                            }
                        })
                );
            } catch (ex) {
                traceError(`Failed to refresh list of interpreters and get their details`, ex);
            }
        });
        if (cancelToken.isCancellationRequested) {
            return [];
        }

        traceVerbose(
            `Full interpreter list is length: ${allInterpreters.length}, ${allInterpreters
                .map((item) => `${item.id}:${item.displayName}:${item.envType}:${getDisplayPath(item.uri)}`)
                .join(', ')}`
        );
        return allInterpreters;
    }
    /**
     * Python extension API returns all envs from all known workspace folders, including those that do not
     * belong to the currently opened workspace folders.
     * This will is used to determine whether an env belongs to the currently opened workspace folders.
     */
    private isValidWorkSpaceRelatedEnvironment(env: PythonEnvironmentV2 | ResolvedEnvironment) {
        const envWorkspaceFolder = env?.environment?.workspaceFolder;
        if (envWorkspaceFolder) {
            if (!this.workspace.workspaceFolders) {
                traceVerbose(`Exclude env ${env.id} as it belongs to a workspace folder`);
                return false;
            }
            if (
                !this.workspace.workspaceFolders.some((item) => item.uri.toString() === envWorkspaceFolder.toString())
            ) {
                traceVerbose(`Exclude env ${env.id} as it belongs to a different workspace folder`);
                return false;
            }
        }
        return true;
    }
    private builtListOfInterpretersAtLeastOnce?: boolean;
    private buildListOfInterpretersForFirstTime() {
        if (this.builtListOfInterpretersAtLeastOnce) {
            return;
        }
        // Get latest interpreter list in the background.
        if (this.extensionChecker.isPythonExtensionActive) {
            this.builtListOfInterpretersAtLeastOnce = true;
            this.populateCachedListOfInterpreters();
        }
        this.extensionChecker.onPythonExtensionInstallationStatusChanged(
            (e) => {
                if (e !== 'installed') {
                    return;
                }
                if (this.extensionChecker.isPythonExtensionActive) {
                    this.populateCachedListOfInterpreters();
                }
            },
            this,
            this.disposables
        );
    }
    private hookupOnDidChangeInterpreterEvent() {
        // Only do this once.
        if (this.eventHandlerAdded) {
            return;
        }
        this.buildListOfInterpretersForFirstTime();
        this.getApi()
            .then((api) => {
                if (!this.eventHandlerAdded && api) {
                    this.eventHandlerAdded = true;
                    api.environments.onDidChangeActiveEnvironmentPath(
                        () => {
                            this.interpreterListCachePromise = undefined;
                            this.workspaceCachedActiveInterpreter.clear();
                            this.didChangeInterpreter.fire();
                        },
                        this,
                        this.disposables
                    );
                    api.environments.onDidChangeEnvironments(
                        () => {
                            this.interpreterListCachePromise = undefined;
                            this.refreshInterpreters().ignoreErrors();
                            this.populateCachedListOfInterpreters();
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
