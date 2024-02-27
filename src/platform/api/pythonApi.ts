// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
    EventEmitter,
    Event,
    Uri,
    ExtensionMode,
    CancellationTokenSource,
    CancellationToken,
    workspace,
    extensions,
    window,
    commands
} from 'vscode';
import { IPythonApiProvider, IPythonExtensionChecker, PythonApi, PythonEnvironment_PythonApi } from './types';
import * as localize from '../common/utils/localize';
import { injectable, inject } from 'inversify';
import { sendTelemetryEvent } from '../../telemetry';
import { isCI, PythonExtension, Telemetry } from '../common/constants';
import { IDisposableRegistry, IExtensionContext } from '../common/types';
import { createDeferred, sleep } from '../common/utils/async';
import { traceError, traceInfo, traceInfoIfCI, traceVerbose, traceWarning } from '../logging';
import { getDisplayPath, getFilePath } from '../common/platform/fs-paths';
import { IInterpreterService } from '../interpreter/contracts';
import { areInterpreterPathsSame, getInterpreterHash } from '../pythonEnvironments/info/interpreter';
import { EnvironmentType, PythonEnvironment } from '../pythonEnvironments/info';
import { areObjectsWithUrisTheSame, isUri, noop } from '../common/utils/misc';
import { StopWatch } from '../common/utils/stopWatch';
import { Environment, PythonExtension as PythonExtensionApi, ResolvedEnvironment } from '@vscode/python-extension';
import { PromiseMonitor } from '../common/utils/promises';
import { PythonExtensionActicationFailedError } from '../errors/pythonExtActivationFailedError';
import { PythonExtensionApiNotExportedError } from '../errors/pythonExtApiNotExportedError';
import { getOSType, OSType } from '../common/utils/platform';
import { SemVer } from 'semver';
import {
    getCachedVersion,
    getEnvironmentType,
    isCondaEnvironmentWithoutPython,
    setPythonApi
} from '../interpreter/helpers';
import { getWorkspaceFolderIdentifier } from '../common/application/workspace.base';

export function deserializePythonEnvironment(
    pythonVersion: Partial<PythonEnvironment_PythonApi> | undefined,
    pythonEnvId: string
): PythonEnvironment | undefined {
    if (pythonVersion) {
        const result = {
            ...pythonVersion,
            uri: Uri.file(pythonVersion.path || ''),
            id: pythonEnvId || (pythonVersion as any).id,
            displayPath:
                'displayPath' in pythonVersion && typeof pythonVersion.displayPath === 'string'
                    ? Uri.file(pythonVersion.displayPath)
                    : undefined
        };

        // Cleanup stuff that shouldn't be there.
        delete result.path;
        return result;
    }
}
export function resolvedPythonEnvToJupyterEnv(
    env: ResolvedEnvironment,
    supportsEmptyCondaEnv: boolean
): PythonEnvironment | undefined {
    // Map the Python env tool to a Jupyter environment type.
    let uri: Uri;
    let id = env.id;
    if (!env.executable.uri) {
        if (getEnvironmentType(env) === EnvironmentType.Conda && supportsEmptyCondaEnv) {
            uri =
                getOSType() === OSType.Windows
                    ? Uri.joinPath(env.environment?.folderUri || Uri.file(env.path), 'python.exe')
                    : Uri.joinPath(env.environment?.folderUri || Uri.file(env.path), 'bin', 'python');
        } else {
            traceWarning(`Python environment ${getDisplayPath(env.id)} excluded as Uri is undefined`);
            return;
        }
    } else {
        uri = env.executable.uri;
    }

    return {
        id,
        displayPath: env.environment?.folderUri || Uri.file(env.path),
        envName: env.environment?.name || '',
        uri,
        displayName: env.environment?.name || ''
    };
}
export function pythonEnvToJupyterEnv(env: Environment): PythonEnvironment | undefined {
    let uri: Uri;
    let id = env.id;
    if (!env.executable.uri) {
        if (getEnvironmentType(env) === EnvironmentType.Conda) {
            uri =
                getOSType() === OSType.Windows
                    ? Uri.joinPath(env.environment?.folderUri || Uri.file(env.path), 'python.exe')
                    : Uri.joinPath(env.environment?.folderUri || Uri.file(env.path), 'bin', 'python');
        } else {
            traceWarning(`Python environment ${getDisplayPath(env.id)} excluded as Uri is undefined`);
            return;
        }
    } else {
        uri = env.executable.uri;
    }

    return {
        id,
        displayPath: env.environment?.folderUri || Uri.file(env.path),
        envName: env.environment?.name || '',
        uri,
        displayName: env.environment?.name || ''
    };
}

export function serializePythonEnvironment(
    jupyterVersion: PythonEnvironment | undefined
): PythonEnvironment_PythonApi | undefined {
    if (jupyterVersion) {
        const result = Object.assign({}, jupyterVersion, {
            path: getFilePath(jupyterVersion.uri),
            displayPath: jupyterVersion.displayPath ? getFilePath(jupyterVersion.displayPath) : undefined
        });
        // Cleanup stuff that shouldn't be there.
        delete (result as any).uri;
        return result;
    }
}

/* eslint-disable max-classes-per-file */
@injectable()
export class OldPythonApiProvider implements IPythonApiProvider {
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
    public get pythonExtensionVersion(): SemVer | undefined {
        return this._pythonExtensionVersion;
    }

    private initialized?: boolean;
    private hooksRegistered?: boolean;
    private _pythonExtensionVersion?: SemVer | undefined;

    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IPythonExtensionChecker) private extensionChecker: IPythonExtensionChecker
    ) {
        const previouslyInstalled = this.extensionChecker.isPythonExtensionInstalled;
        if (!previouslyInstalled) {
            extensions.onDidChange(
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
    public async getNewApi(): Promise<PythonExtensionApi | undefined> {
        await this.init();
        const extension = extensions.getExtension<PythonExtensionApi>(PythonExtension);
        if (extension?.packageJSON?.version) {
            this._pythonExtensionVersion = new SemVer(extension?.packageJSON?.version);
        }
        if (extension?.exports) {
            setPythonApi(extension.exports);
        }
        return extension?.exports;
    }

    public setApi(api: PythonApi): void {
        // Never allow accessing python API (we don't want to ever use the API and run code in untrusted API).
        // Don't assume Python API will always be disabled in untrusted workspaces.
        if (this.api.resolved || !workspace.isTrusted) {
            return;
        }
        this.api.resolve(api);
    }

    private async init() {
        if (this.initialized) {
            return;
        }
        const pythonExtension = extensions.getExtension<{ jupyter: { registerHooks(): void } }>(PythonExtension);
        if (!pythonExtension) {
            await this.extensionChecker.showPythonExtensionInstallRequiredPrompt();
        } else {
            await this.registerHooks();
        }
        this.initialized = true;
    }
    private async registerHooks() {
        if (this.hooksRegistered) {
            return;
        }
        const pythonExtension = extensions.getExtension<{ jupyter: { registerHooks(): void } }>(PythonExtension);
        if (!pythonExtension) {
            return;
        }
        let activated = false;
        if (!pythonExtension.isActive) {
            try {
                await pythonExtension.activate();
                activated = true;
            } catch (ex) {
                traceError(`Failed activating the python extension: `, ex);
                this.api.reject(new PythonExtensionActicationFailedError(ex));
                return;
            }
        }
        if (this.hooksRegistered) {
            return;
        }
        this.hooksRegistered = true;
        if (activated) {
            this.didActivatePython.fire();
        }
        if (!pythonExtension.exports?.jupyter) {
            traceError(`Python extension is not exporting the jupyter API`);
            this.api.reject(new PythonExtensionApiNotExportedError());
        } else {
            pythonExtension.exports.jupyter.registerHooks();
        }
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
    constructor(@inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry) {
        // Listen for the python extension being installed or uninstalled
        extensions.onDidChange(this.extensionsChangeHandler.bind(this), this, this.disposables);

        // Name is a bit different here as we use the isPythonExtensionInstalled property for checking the current state.
        // This property is to see if we change it during extension actions.
        this.previousInstallState = this.isPythonExtensionInstalled;
    }

    public get isPythonExtensionInstalled() {
        return extensions.getExtension(PythonExtension) !== undefined;
    }
    public get isPythonExtensionActive() {
        return extensions.getExtension(PythonExtension)?.isActive === true;
    }

    // Directly install the python extension instead of just showing the extension open page
    public async directlyInstallPythonExtension(): Promise<void> {
        return commands.executeCommand('workbench.extensions.installExtension', PythonExtension, {
            context: { skipWalkthrough: true }
        });
    }

    // Notify the user that Python is require, and open up the Extension installation page to the
    // python extension
    public async showPythonExtensionInstallRequiredPrompt(): Promise<void> {
        // If workspace is not trusted, then don't show prompt
        if (!workspace.isTrusted) {
            return;
        }

        PythonExtensionChecker.promptDisplayed = true;
        // Ask user if they want to install and then wait for them to actually install it.
        const yes = localize.Common.bannerLabelYes;
        sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'displayed' });
        const answer = await window.showInformationMessage(
            localize.DataScience.pythonExtensionRequired,
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
        commands.executeCommand('extension.open', PythonExtension).then(noop, noop);
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

type InterpreterId = string;
// eslint-disable-next-line max-classes-per-file
@injectable()
export class InterpreterService implements IInterpreterService {
    private readonly didChangeInterpreter = new EventEmitter<PythonEnvironment | undefined>();
    private readonly didChangeInterpreters = new EventEmitter<PythonEnvironment[]>();
    private readonly _onDidEnvironmentVariablesChange = new EventEmitter<void>();
    private readonly _onDidRemoveInterpreter = new EventEmitter<{ id: string }>();
    public onDidRemoveInterpreter = this._onDidRemoveInterpreter.event;
    public onDidEnvironmentVariablesChange = this._onDidEnvironmentVariablesChange.event;
    private eventHandlerAdded?: boolean;
    private interpreterListCachePromise: Promise<PythonEnvironment[]> | undefined = undefined;
    private apiPromise: Promise<PythonExtensionApi | undefined> | undefined;
    private _status: 'refreshing' | 'idle' = 'idle';
    public get status() {
        return this._status;
    }
    private set status(value: typeof this._status) {
        if (this._status === value) {
            return;
        }
        this._status = value;
        this._onDidChangeStatus.fire();
    }
    private readonly _onDidChangeStatus = new EventEmitter<void>();
    public readonly onDidChangeStatus = this._onDidChangeStatus.event;
    private refreshPromises = new PromiseMonitor();
    private pauseEnvDetection = false;
    private readonly onResumeEnvDetection = new EventEmitter<void>();
    constructor(
        @inject(IPythonApiProvider) private readonly apiProvider: IPythonApiProvider,
        @inject(IPythonExtensionChecker) private extensionChecker: IPythonExtensionChecker,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
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
        workspace.onDidChangeWorkspaceFolders(this.onDidChangeWorkspaceFolders, this, disposables);
        workspace.onDidGrantWorkspaceTrust(() => this.refreshInterpreters(true), this, this.disposables);
        this.disposables.push(this._onDidChangeStatus);
        this.disposables.push(this.refreshPromises);
        this.disposables.push(this.onResumeEnvDetection);
        this.refreshPromises.onStateChange(() => {
            this.status = this.refreshPromises.isComplete ? 'idle' : 'refreshing';
        });
        workspace.onDidGrantWorkspaceTrust(
            () => this.populateCachedListOfInterpreters(true).catch(noop),
            this,
            this.disposables
        );
    }
    public async resolveEnvironment(id: string | Environment): Promise<ResolvedEnvironment | undefined> {
        return this.getApi().then((api) => {
            if (!api) {
                return;
            }
            const env = typeof id === 'string' ? api.environments.known.find((e) => e.id === id || e.path === id) : id;
            return api.environments.resolveEnvironment(env || id);
        });
    }
    public get onDidChangeInterpreter(): Event<PythonEnvironment | undefined> {
        this.hookupOnDidChangeInterpreterEvent();
        return this.didChangeInterpreter.event;
    }

    public get onDidChangeInterpreters(): Event<PythonEnvironment[]> {
        this.hookupOnDidChangeInterpreterEvent();
        return this.didChangeInterpreters.event;
    }
    private readonly _interpreters = new Map<string, { resolved: PythonEnvironment }>();
    public get resolvedEnvironments(): PythonEnvironment[] {
        this.hookupOnDidChangeInterpreterEvent();
        return Array.from(this._interpreters.values()).map((item) => item.resolved);
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
            this.interpreterListCachePromise.finally(() => cancellation.dispose()).catch(noop);
            this.refreshPromises.push(this.interpreterListCachePromise);
        }
        return this.interpreterListCachePromise;
    }
    pauseInterpreterDetection(cancelToken: CancellationToken): void {
        if (cancelToken.isCancellationRequested) {
            return;
        }
        this.pauseEnvDetection = true;
        cancelToken.onCancellationRequested(
            () => {
                this.pauseEnvDetection = false;
                this.triggerPendingEvents();
            },
            this,
            this.disposables
        );
    }
    public async refreshInterpreters(forceRefresh: boolean = false) {
        const promise = (async () => {
            const api = await this.getApi();
            if (!api) {
                return;
            }
            try {
                await api.environments.refreshEnvironments({ forceRefresh });
                this.interpreterListCachePromise = undefined;
                await this.getInterpreters();
                traceVerbose(`Refreshed Environments`);
            } catch (ex) {
                traceError(`Failed to refresh the list of interpreters`);
            }
        })();
        this.refreshPromises.push(promise);
        // Python extension might completely this promise, however this doesn't mean all of the
        // events have been triggered,
        // I.e. even after we call refresh the python extension could trigger events indicating that there are more changes to the interpreters.
        // Hence wait for at least 2 seconds for these events to complete getting triggered.
        // Why 2s and not 5 or why not 1s, there's no real reason, just a guess.
        // This promise only improves the discovery of kernels, even without this things work,
        // but with this things work better as the kernel discovery knows that Python refresh has finished.
        this.refreshPromises.push(promise.then(() => sleep(1_000)));
        await promise;
    }
    private workspaceCachedActiveInterpreter = new Set<string>();
    private lastLoggedResourceAndInterpreterId = '';
    public async getActiveInterpreter(resource?: Uri): Promise<PythonEnvironment | undefined> {
        if (!workspace.isTrusted) {
            return;
        }
        const stopWatch = new StopWatch();
        this.hookupOnDidChangeInterpreterEvent();
        // If there's only one workspace folder, and we don't have a resource, then use the
        // workspace uri of the single workspace folder.
        if (!resource && workspace.workspaceFolders?.length === 1) {
            resource = workspace.workspaceFolders[0].uri;
        }
        // We need a valid resource, thats associated with a workspace folder
        if (workspace.workspaceFolders?.length) {
            resource =
                (resource ? workspace.getWorkspaceFolder(resource)?.uri : undefined) ||
                workspace.workspaceFolders[0].uri;
        }
        const workspaceId = getWorkspaceFolderIdentifier(resource);
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
                .then((item) => {
                    // Reduce excessive logging.
                    const key = `${getDisplayPath(resource)}'-${getDisplayPath(item?.id)}`;
                    if (this.lastLoggedResourceAndInterpreterId === key) {
                        return;
                    }
                    this.lastLoggedResourceAndInterpreterId = key;
                    const version = getCachedVersion(item);
                    traceInfo(
                        `Active Interpreter ${resource ? `for '${getDisplayPath(resource)}' ` : ''}is ${getDisplayPath(
                            item?.id
                        )} (${
                            item && getEnvironmentType(item)
                        }, '${item?.envName}', ${version?.major}.${version?.minor}.${version?.micro})`
                    );
                })
                .catch(noop);
        }
        return promise;
    }
    private readonly pythonEnvHashes = new Map<string, string>();
    getInterpreterHash(id: string) {
        return this.pythonEnvHashes.get(id);
    }

    private loggedEnvsWithoutInterpreterPath = new Set<string>();
    public async getInterpreterDetails(
        pythonPath: Uri | { path: string } | InterpreterId,
        token?: CancellationToken
    ): Promise<undefined | PythonEnvironment> {
        if (!workspace.isTrusted) {
            throw new Error('Unable to determine active Interpreter as Workspace is not trusted');
        }

        this.hookupOnDidChangeInterpreterEvent();
        try {
            return await this.getApi().then(async (api) => {
                if (!api || token?.isCancellationRequested) {
                    return;
                }
                // Find the Env with the same Uri.
                const matchedPythonEnv = api.environments.known.find((item) => {
                    return isUri(pythonPath)
                        ? areInterpreterPathsSame(item.executable.uri, pythonPath)
                        : typeof pythonPath === 'string'
                        ? item.id === pythonPath
                        : areInterpreterPathsSame(Uri.file(item.path), Uri.file(pythonPath.path));
                });
                const pythonPathForLogging = isUri(pythonPath)
                    ? getDisplayPath(pythonPath)
                    : typeof pythonPath === 'string'
                    ? pythonPath
                    : getDisplayPath(Uri.file(pythonPath.path));
                if (matchedPythonEnv) {
                    const env = await api.environments.resolveEnvironment(matchedPythonEnv);
                    const resolved = this.trackResolvedEnvironment(env);
                    traceInfoIfCI(
                        `Interpreter details for ${pythonPathForLogging} from Python is ${JSON.stringify(
                            env
                        )} and our mapping is ${JSON.stringify(resolved)}`
                    );
                    return resolved;
                }
                const key = pythonPathForLogging;
                // Reduce excessive logging.
                if (!this.loggedEnvsWithoutInterpreterPath.has(key)) {
                    this.loggedEnvsWithoutInterpreterPath.add(key);
                    traceWarning(
                        `No interpreter with path ${pythonPathForLogging} found in Python API, will convert Uri path to string as Id ${pythonPathForLogging}`
                    );
                }
                if (token?.isCancellationRequested) {
                    return;
                }
                const env = await api.environments.resolveEnvironment(
                    // eslint-disable-next-line local-rules/dont-use-fspath
                    isUri(pythonPath) ? pythonPath.fsPath : typeof pythonPath == 'string' ? pythonPath : pythonPath.path
                );
                return this.trackResolvedEnvironment(env);
            });
        } catch (ex) {
            traceWarning(
                `Failed to get Python interpreter details from Python Extension API for ${
                    typeof pythonPath === 'string'
                        ? pythonPath
                        : getDisplayPath(isUri(pythonPath) ? pythonPath : Uri.file(pythonPath.path))
                }`,
                ex
            );
            // If the python extension cannot get the details here, don't fail. Just don't use them.
            return undefined;
        }
    }
    private trackResolvedEnvironment(env: ResolvedEnvironment | undefined) {
        if (env) {
            const displayEmptyCondaEnv =
                this.apiProvider.pythonExtensionVersion &&
                this.apiProvider.pythonExtensionVersion.compare('2023.3.10341119') >= 0;
            const resolved = resolvedPythonEnvToJupyterEnv(env, displayEmptyCondaEnv ? true : false);
            if (!resolved) {
                return;
            }
            getInterpreterHash(resolved)
                .then((hash) => {
                    this.pythonEnvHashes.set(resolved.id, hash);
                })
                .catch(noop);

            if (
                !this._interpreters.get(env.id) ||
                !areObjectsWithUrisTheSame(resolved, this._interpreters.get(env.id)?.resolved)
            ) {
                // Also update the interpreter details in place, so that old references get the latest details
                const info = this._interpreters.get(env.id);
                if (info?.resolved) {
                    Object.assign(info.resolved, resolved);
                }
                this._interpreters.set(env.id, { resolved });
                this.triggerEventIfAllowed('interpretersChangeEvent', resolved);
            }
            return resolved;
        }
    }
    private pendingInterpreterChangeEventTriggers = new Map<InterpreterId, PythonEnvironment | undefined>();
    private pendingInterpretersChangeEventTriggers = new Map<InterpreterId, PythonEnvironment | undefined>();
    private triggerEventIfAllowed(
        changeType: 'interpreterChangeEvent' | 'interpretersChangeEvent',
        interpreter?: PythonEnvironment
    ) {
        if (changeType === 'interpreterChangeEvent') {
            this.pendingInterpreterChangeEventTriggers.set(interpreter?.id || '', interpreter);
        } else {
            this.pendingInterpretersChangeEventTriggers.set(interpreter?.id || '', interpreter);
        }
        if (!this.pauseEnvDetection) {
            this.triggerPendingEvents();
            return;
        }
    }
    private triggerPendingEvents() {
        this.pendingInterpreterChangeEventTriggers.forEach((interpreter) =>
            this.didChangeInterpreter.fire(interpreter)
        );
        this.pendingInterpreterChangeEventTriggers.clear();
        const interpreters = Array.from(this.pendingInterpretersChangeEventTriggers.values());
        if (interpreters.length) {
            const nonEmptyInterpreterList = interpreters.filter((item) => !!item) as PythonEnvironment[];
            if (nonEmptyInterpreterList.length !== interpreters.length && nonEmptyInterpreterList.length === 0) {
                // Trigger an empty event.
                this.didChangeInterpreters.fire([]);
            } else {
                this.didChangeInterpreters.fire(nonEmptyInterpreterList);
            }
        }
        this.pendingInterpretersChangeEventTriggers.clear();
    }
    private async getApi(): Promise<PythonExtensionApi | undefined> {
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
    private populateCachedListOfInterpreters(clearCache?: boolean) {
        if (clearCache) {
            this.interpreterListCachePromise = undefined;
        }
        const promise = this.getInterpreters().catch(noop);
        this.refreshPromises.push(promise);
        // Python extension might completely this promise, however this doesn't mean all of the
        // events have been triggered,
        // I.e. even after we call refresh the python extension could trigger events indicating that there are more changes to the interpreters.
        // Hence wait for at least 2 seconds for these events to complete getting triggered.
        // Why 2s and not 5 or why not 1s, there's no real reason, just a guess.
        // This promise only improves the discovery of kernels, even without this things work,
        // but with this things work better as the kernel discovery knows that Python refresh has finished.
        this.refreshPromises.push(promise.then(() => sleep(1_000)));
        return promise;
    }
    private async getInterpretersImpl(
        cancelToken: CancellationToken,
        recursiveCounter = 0
    ): Promise<PythonEnvironment[]> {
        if (!workspace.isTrusted) {
            return [];
        }

        if (this.extensionChecker.isPythonExtensionInstalled) {
            this.builtListOfInterpretersAtLeastOnce = true;
        }

        const allInterpreters: PythonEnvironment[] = [];
        let buildListOfInterpretersAgain = false;
        await this.getApi().then(async (api) => {
            if (!api || cancelToken.isCancellationRequested) {
                return [];
            }
            let previousListOfInterpreters = api.environments.known.length;
            try {
                await Promise.all(
                    api.environments.known.map(async (item) => {
                        try {
                            const env = await api.environments.resolveEnvironment(item);
                            const resolved = this.trackResolvedEnvironment(env);
                            if (resolved) {
                                allInterpreters.push(resolved);
                            } else if (item.executable.uri && item.environment?.type !== EnvironmentType.Conda) {
                                // Ignore cases where we do not have Uri and its a conda env, as those as conda envs without Python.
                                traceError(
                                    `Failed to get env details from Python API for ${getDisplayPath(
                                        item.id
                                    )} without an error`
                                );
                            }
                        } catch (ex) {
                            traceError(`Failed to get env details from Python API for ${getDisplayPath(item.id)}`, ex);
                        }
                    })
                );
                // We have updated the list of environments, trigger a change
                // Possible one of the environments was resolve even before this method started.
                // E.g. we got active interpreter details, and then we came here.
                // At this point the env is already resolved, but we did not trigger a change event.
                this.triggerEventIfAllowed('interpretersChangeEvent', undefined);
            } catch (ex) {
                traceError(`Failed to refresh list of interpreters and get their details`, ex);
            }

            if (previousListOfInterpreters < api.environments.known.length) {
                // this means we haven't completed the first refresh of the list of interpreters.
                // We've received yet another set of interpreters.
                buildListOfInterpretersAgain = true;
            }
        });
        if (cancelToken.isCancellationRequested) {
            return [];
        }
        if (buildListOfInterpretersAgain && recursiveCounter < 10) {
            traceVerbose(
                `List of interpreters changed after a while, will need to rebuild it again, counter = ${recursiveCounter}`
            );
            return this.getInterpretersImpl(cancelToken, recursiveCounter++);
        }
        traceVerbose(
            `Full interpreter list is length: ${allInterpreters.length}, ${allInterpreters
                .map((item) => `${item.id}:${item.displayName}:${getEnvironmentType(item)}:${getDisplayPath(item.uri)}`)
                .join(', ')}`
        );
        return allInterpreters;
    }
    private builtListOfInterpretersAtLeastOnce?: boolean;
    private buildListOfInterpretersForFirstTime() {
        if (this.builtListOfInterpretersAtLeastOnce) {
            return;
        }
        // Get latest interpreter list in the background.
        if (this.extensionChecker.isPythonExtensionActive) {
            this.builtListOfInterpretersAtLeastOnce = true;
            this.populateCachedListOfInterpreters().catch(noop);
        }
        this.extensionChecker.onPythonExtensionInstallationStatusChanged(
            (e) => {
                if (e !== 'installed') {
                    return;
                }
                if (this.extensionChecker.isPythonExtensionActive) {
                    this.populateCachedListOfInterpreters().catch(noop);
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
                    api.environments.onDidEnvironmentVariablesChange(
                        (e) => {
                            traceVerbose(`Detected changes to env file ${e.resource?.uri?.path} in PythonApi`);
                            this._onDidEnvironmentVariablesChange.fire();
                        },
                        this,
                        this.disposables
                    );
                    api.environments.onDidChangeActiveEnvironmentPath(
                        () => {
                            traceVerbose(`Detected change in Active Python environment via Python API`);
                            this.interpreterListCachePromise = undefined;
                            this.workspaceCachedActiveInterpreter.clear();
                            this.triggerEventIfAllowed('interpreterChangeEvent', undefined);
                        },
                        this,
                        this.disposables
                    );
                    api.environments.onDidChangeEnvironments(
                        async (e) => {
                            traceVerbose(`Python API env change detected, ${e.type} => '${e.env.id}'`);
                            // Remove items that are no longer valid.
                            if (e.type === 'remove') {
                                this._interpreters.delete(e.env.id);
                            }
                            // If this is a conda env that was previously resolved,
                            // & subsequently updated as having python then trigger changes.
                            const pythonInstalledIntoConda =
                                e.type === 'update' &&
                                isCondaEnvironmentWithoutPython(this._interpreters.get(e.env.id)?.resolved) &&
                                e.env.executable.uri
                                    ? true
                                    : false;
                            this.populateCachedListOfInterpreters(true)
                                .finally(() => {
                                    const info = this._interpreters.get(e.env.id);
                                    if (e.type === 'remove' && !info) {
                                        this.triggerEventIfAllowed('interpreterChangeEvent', undefined);
                                        this.triggerEventIfAllowed('interpretersChangeEvent', undefined);
                                        this._onDidRemoveInterpreter.fire({ id: e.env.id });
                                    } else if (
                                        e.type === 'update' &&
                                        info &&
                                        pythonInstalledIntoConda &&
                                        !isCondaEnvironmentWithoutPython(info.resolved)
                                    ) {
                                        this.triggerEventIfAllowed('interpreterChangeEvent', info.resolved);
                                        this.triggerEventIfAllowed('interpretersChangeEvent', info.resolved);
                                    }
                                })
                                .catch(noop);
                        },
                        this,
                        this.disposables
                    );
                }
            })
            .catch(noop);
    }
}
