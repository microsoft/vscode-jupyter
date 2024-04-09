// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
    EventEmitter,
    Event,
    Uri,
    ExtensionMode,
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
import { isUri, noop } from '../common/utils/misc';
import { StopWatch } from '../common/utils/stopWatch';
import { Environment, PythonExtension as PythonExtensionApi, ResolvedEnvironment } from '@vscode/python-extension';
import { PromiseMonitor } from '../common/utils/promises';
import { PythonExtensionActicationFailedError } from '../errors/pythonExtActivationFailedError';
import { PythonExtensionApiNotExportedError } from '../errors/pythonExtApiNotExportedError';
import { getOSType, OSType } from '../common/utils/platform';
import { SemVer } from 'semver';
import {
    getCachedEnvironment,
    getCachedEnvironments,
    getCachedVersion,
    getEnvironmentType,
    getPythonEnvironmentName,
    resolvedPythonEnvToJupyterEnv,
    setPythonApi
} from '../interpreter/helpers';
import { getWorkspaceFolderIdentifier } from '../common/application/workspace.base';
import { trackInterpreterDiscovery, trackPythonExtensionActivation } from '../../kernels/telemetry/notebookTelemetry';

export function deserializePythonEnvironment(
    pythonVersion: Partial<PythonEnvironment_PythonApi> | undefined,
    pythonEnvId: string
): PythonEnvironment | undefined {
    if (pythonVersion) {
        const result = {
            ...pythonVersion,
            uri: Uri.file(pythonVersion.path || ''),
            id: pythonEnvId || (pythonVersion as any).id
        };

        // Cleanup stuff that shouldn't be there.
        delete result.path;
        return result;
    }
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
        uri
    };
}

export function serializePythonEnvironment(
    jupyterVersion: PythonEnvironment | undefined
): PythonEnvironment_PythonApi | undefined {
    if (jupyterVersion) {
        const result = Object.assign({}, jupyterVersion, {
            path: getFilePath(jupyterVersion.uri)
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
            extension.exports.environments.known.forEach((e) => {
                trackInterpreterDiscovery(e);
            });
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
            const tracker = trackPythonExtensionActivation();
            try {
                const promise = pythonExtension.activate();
                promise.then(
                    () => tracker.stop(),
                    () => tracker.stop()
                );
                await promise;
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
    // private interpreterListCachePromise: Promise<PythonEnvironment[]> | undefined = undefined;
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
    private readonly onResumeEnvDetection = new EventEmitter<void>();
    constructor(
        @inject(IPythonApiProvider) private readonly apiProvider: IPythonApiProvider,
        @inject(IPythonExtensionChecker) private extensionChecker: IPythonExtensionChecker,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IExtensionContext) private readonly context: IExtensionContext
    ) {
        if (this.extensionChecker.isPythonExtensionInstalled && !this.extensionChecker.isPythonExtensionActive) {
            // This event may not fire. It only fires if we're the reason for python extension
            // activation. VS code does not fire such an event itself if something else activates
            this.apiProvider.onDidActivatePythonExtension(
                () => {
                    this.hookupOnDidChangeInterpreterEvent();
                },
                this,
                this.disposables
            );
        }
        workspace.onDidGrantWorkspaceTrust(() => this.refreshInterpreters(true), this, this.disposables);
        this.disposables.push(this._onDidChangeStatus);
        this.disposables.push(this.refreshPromises);
        this.disposables.push(this.onResumeEnvDetection);
        this.refreshPromises.onStateChange(() => {
            this.status = this.refreshPromises.isComplete ? 'idle' : 'refreshing';
        });
    }
    public initialize() {
        this.hookupOnDidChangeInterpreterEvent();
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
    public async refreshInterpreters(forceRefresh: boolean = false) {
        const promise = (async () => {
            const api = await this.getApi();
            if (!api) {
                return;
            }
            try {
                await api.environments.refreshEnvironments({ forceRefresh });
                this.hookupOnDidChangeInterpreterEvent();
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
                        )} (${item && getEnvironmentType(item)}, '${
                            item ? getPythonEnvironmentName(item) : ''
                        }', ${version?.major}.${version?.minor}.${version?.micro})`
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
            const resolved = resolvedPythonEnvToJupyterEnv(env);
            if (!resolved) {
                return;
            }
            getInterpreterHash(resolved)
                .then((hash) => {
                    this.pythonEnvHashes.set(resolved.id, hash);
                })
                .catch(noop);

            this.triggerEventIfAllowed('interpretersChangeEvent', resolved);
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
        this.triggerPendingEvents();
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
        }
        return this.apiPromise;
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
                                this.triggerEventIfAllowed('interpreterChangeEvent', undefined);
                                this.triggerEventIfAllowed('interpretersChangeEvent', undefined);
                                this._onDidRemoveInterpreter.fire({ id: e.env.id });
                                return;
                            }
                            const info = resolvedPythonEnvToJupyterEnv(getCachedEnvironment(e.env));
                            if (info) {
                                this.triggerEventIfAllowed('interpreterChangeEvent', info);
                                this.triggerEventIfAllowed('interpretersChangeEvent', info);
                            }
                        },
                        this,
                        this.disposables
                    );
                    this.didChangeInterpreters.fire(
                        getCachedEnvironments()
                            .map(resolvedPythonEnvToJupyterEnv)
                            .filter((e) => !!e)
                            .map((e) => e as PythonEnvironment)
                    );
                }
            })
            .catch(noop);
    }
}
