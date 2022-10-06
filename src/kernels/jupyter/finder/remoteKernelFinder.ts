// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { injectable, inject, named } from 'inversify';
import { CancellationToken, CancellationTokenSource, Event, EventEmitter, Memento, Uri } from 'vscode';
import { getKernelId, getLanguageInKernelSpec, serializeKernelConnection } from '../../helpers';
import {
    IJupyterKernelSpec,
    IKernelFinder,
    IKernelProvider,
    INotebookProvider,
    INotebookProviderConnection,
    isRemoteConnection,
    KernelConnectionMetadata,
    LiveRemoteKernelConnectionMetadata,
    RemoteKernelConnectionMetadata,
    RemoteKernelSpecConnectionMetadata
} from '../../types';
import {
    GLOBAL_MEMENTO,
    IDisposableRegistry,
    IExtensions,
    IMemento,
    IsWebExtension,
    Resource
} from '../../../platform/common/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { capturePerfTelemetry, Telemetry } from '../../../telemetry';
import {
    IJupyterSessionManagerFactory,
    IJupyterSessionManager,
    IJupyterServerUriStorage,
    IServerConnectionType,
    IJupyterRemoteCachedKernelValidator,
    IRemoteKernelFinder
} from '../types';
import { sendKernelSpecTelemetry } from '../../raw/finder/helper';
import { traceError, traceWarning, traceInfoIfCI } from '../../../platform/logging';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { computeServerId } from '../jupyterUtils';
import { PYTHON_LANGUAGE } from '../../../platform/common/constants';
import { createPromiseFromCancellation } from '../../../platform/common/cancellation';
import { DisplayOptions } from '../../displayOptions';
import { isArray } from '../../../platform/common/utils/sysTypes';
import { deserializeKernelConnection } from '../../helpers';
import { noop } from '../../../platform/common/utils/misc';
import { IApplicationEnvironment } from '../../../platform/common/application/types';
import { KernelFinder } from '../../kernelFinder';
import { RemoteKernelSpecsCacheKey, removeOldCachedItems } from '../../common/commonFinder';
import { IExtensionSingleActivationService } from '../../../platform/activation/types';

// Even after shutting down a kernel, the server API still returns the old information.
// Re-query after 2 seconds to ensure we don't get stale information.
const REMOTE_KERNEL_REFRESH_INTERVAL = 2_000;

// This class searches for a kernel that matches the given kernel name.
// First it searches on a global persistent state, then on the installed python interpreters,
// and finally on the default locations that jupyter installs kernels on.
@injectable()
export class RemoteKernelFinder implements IRemoteKernelFinder, IExtensionSingleActivationService {
    /**
     * List of ids of kernels that should be hidden from the kernel picker.
     */
    private readonly kernelIdsToHide = new Set<string>();
    kind: string = 'remote';
    private _cacheUpdateCancelTokenSource: CancellationTokenSource | undefined;
    private cache: RemoteKernelConnectionMetadata[] = [];

    private _onDidChangeKernels = new EventEmitter<void>();
    onDidChangeKernels: Event<void> = this._onDidChangeKernels.event;

    private _initializeResolve: () => void;
    private _initializedPromise: Promise<void>;

    get initialized(): Promise<void> {
        return this._initializedPromise;
    }

    private wasPythonInstalledWhenFetchingKernels = false;

    constructor(
        @inject(IJupyterSessionManagerFactory) private jupyterSessionManagerFactory: IJupyterSessionManagerFactory,
        @inject(IInterpreterService) private interpreterService: IInterpreterService,
        @inject(IPythonExtensionChecker) private extensionChecker: IPythonExtensionChecker,
        @inject(INotebookProvider) private readonly notebookProvider: INotebookProvider,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(IServerConnectionType) private readonly serverConnectionType: IServerConnectionType,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalState: Memento,
        @inject(IApplicationEnvironment) private readonly env: IApplicationEnvironment,
        @inject(IJupyterRemoteCachedKernelValidator)
        private readonly cachedRemoteKernelValidator: IJupyterRemoteCachedKernelValidator,
        @inject(IKernelFinder) kernelFinder: KernelFinder,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IExtensions) private readonly extensions: IExtensions,
        @inject(IsWebExtension) private isWebExtension: boolean
    ) {
        this._initializedPromise = new Promise<void>((resolve) => {
            this._initializeResolve = resolve;
        });

        kernelFinder.registerKernelFinder(this);
    }

    async activate(): Promise<void> {
        // warm up the cache
        this.loadCache().then(noop, noop);

        this.disposables.push(
            this.serverUriStorage.onDidChangeUri(() => {
                this.updateCache().then(noop, noop);
            })
        );

        // If we create a new kernel, we need to refresh if the kernel is remote (because
        // we have live sessions possible)
        // Note, this is a perf optimization for right now. We should not need
        // to check for remote if the future when we support live sessions on local
        this.kernelProvider.onDidStartKernel((k) => {
            if (isRemoteConnection(k.kernelConnectionMetadata)) {
                // update remote kernels
                this.updateCache().then(noop, noop);
            }
        });

        // For kernel dispose we need to wait a bit, otherwise the list comes back the
        // same
        this.kernelProvider.onDidDisposeKernel(
            (k) => {
                if (k && isRemoteConnection(k.kernelConnectionMetadata)) {
                    const timer = setTimeout(() => {
                        this.updateCache().then(noop, noop);
                    }, REMOTE_KERNEL_REFRESH_INTERVAL);

                    return timer;
                }
            },
            this,
            this.disposables
        );

        this.extensions.onDidChange(
            () => {
                // If we just installed the Python extension and we fetched the controllers, then fetch it again.
                if (!this.wasPythonInstalledWhenFetchingKernels && this.extensionChecker.isPythonExtensionInstalled) {
                    this.updateCache().then(noop, noop);
                }
            },
            this,
            this.disposables
        );
        this.wasPythonInstalledWhenFetchingKernels = this.extensionChecker.isPythonExtensionInstalled;
    }

    public async loadCache() {
        traceInfoIfCI('Remote Kernel Finder load cache', this.serverConnectionType.isLocalLaunch);

        if (this.serverConnectionType.isLocalLaunch) {
            await this.writeToCache([]);
            this._initializeResolve();
            return;
        }

        const kernelsFromCache = await this.getFromCache();

        let kernels: RemoteKernelConnectionMetadata[] = [];

        // If we finish the cache first, and we don't have any items, in the cache, then load without cache.
        if (Array.isArray(kernelsFromCache) && kernelsFromCache.length > 0) {
            kernels = kernelsFromCache;
        } else {
            const kernelsWithoutCachePromise = (async () => {
                const connInfo = await this.getRemoteConnectionInfo();
                return connInfo ? this.listKernelsFromConnection(connInfo) : Promise.resolve([]);
            })();

            kernels = await kernelsWithoutCachePromise;
        }

        await this.writeToCache(kernels);
        this._initializeResolve();
    }

    private async updateCache() {
        let kernels: RemoteKernelConnectionMetadata[] = [];
        this._cacheUpdateCancelTokenSource?.dispose();
        const updateCacheCancellationToken = new CancellationTokenSource();
        this._cacheUpdateCancelTokenSource = updateCacheCancellationToken;

        try {
            const kernelsWithoutCachePromise = (async () => {
                const connInfo = await this.getRemoteConnectionInfo(updateCacheCancellationToken.token);
                return connInfo ? this.listKernelsFromConnection(connInfo) : Promise.resolve([]);
            })();

            kernels = await kernelsWithoutCachePromise;
        } catch (ex) {
            traceWarning(`Could not fetch kernels from the ${this.kind} server, falling back to cache: ${ex}`);
            // Since fetching the remote kernels failed, we fall back to the cache,
            // at this point no need to display all of the kernel specs,
            // Its possible the connection is dead, just display the live kernels we had.
            // I.e. if user had a notebook connected to a remote kernel, then just display that live kernel.
            kernels = await this.getFromCache(updateCacheCancellationToken.token);
            kernels = kernels.filter((item) => item.kind === 'connectToLiveRemoteKernel');
        }

        if (updateCacheCancellationToken.token.isCancellationRequested) {
            return;
        }

        await this.writeToCache(kernels);

        this._onDidChangeKernels.fire();
    }

    /**
     *
     * Remote kernel finder is resource agnostic.
     */
    listContributedKernels(_resource: Resource): KernelConnectionMetadata[] {
        return this.cache;
    }

    private async getRemoteConnectionInfo(
        cancelToken?: CancellationToken
    ): Promise<INotebookProviderConnection | undefined> {
        const ui = new DisplayOptions(false);
        const uri = await this.serverUriStorage.getRemoteUri();
        if (!uri) {
            return;
        }
        return this.notebookProvider.connect({
            resource: undefined,
            ui,
            localJupyter: false,
            token: cancelToken,
            serverId: this.serverUriStorage.currentServerId!
        });
    }

    private async getFromCache(cancelToken?: CancellationToken): Promise<RemoteKernelConnectionMetadata[]> {
        let results: RemoteKernelConnectionMetadata[] = this.cache;
        const key = this.getCacheKey();

        // If not in memory, check memento
        if (!results || results.length === 0) {
            // Check memento too
            const values = this.globalState.get<{
                kernels: RemoteKernelConnectionMetadata[];
                extensionVersion: string;
            }>(key, { kernels: [], extensionVersion: '' });

            if (values && isArray(values.kernels) && values.extensionVersion === this.env.extensionVersion) {
                results = values.kernels.map(deserializeKernelConnection) as RemoteKernelConnectionMetadata[];
                this.cache = results;
            }
        }

        // Validate
        const validValues: RemoteKernelConnectionMetadata[] = [];
        const promise = Promise.all(
            results.map(async (item) => {
                if (await this.isValidCachedKernel(item)) {
                    validValues.push(item);
                }
            })
        );
        if (cancelToken) {
            await Promise.race([
                promise,
                createPromiseFromCancellation({ token: cancelToken, cancelAction: 'resolve', defaultValue: undefined })
            ]);
        } else {
            await promise;
        }
        return validValues;
    }

    // Talk to the remote server to determine sessions
    @capturePerfTelemetry(Telemetry.KernelListingPerf, { kind: 'remote' })
    public async listKernelsFromConnection(
        connInfo: INotebookProviderConnection
    ): Promise<RemoteKernelConnectionMetadata[]> {
        // Get a jupyter session manager to talk to
        let sessionManager: IJupyterSessionManager | undefined;
        // This should only be used when doing remote.
        if (connInfo.type === 'jupyter') {
            try {
                sessionManager = await this.jupyterSessionManagerFactory.create(connInfo);

                // Get running and specs at the same time
                const [running, specs, sessions, serverId] = await Promise.all([
                    sessionManager.getRunningKernels(),
                    sessionManager.getKernelSpecs(),
                    sessionManager.getRunningSessions(),
                    computeServerId(connInfo.url)
                ]);

                // Turn them both into a combined list
                const mappedSpecs = await Promise.all(
                    specs.map(async (s) => {
                        sendKernelSpecTelemetry(s, 'remote');
                        const kernel: RemoteKernelSpecConnectionMetadata = {
                            kind: 'startUsingRemoteKernelSpec',
                            interpreter: await this.getInterpreter(s, connInfo.baseUrl),
                            kernelSpec: s,
                            id: getKernelId(s, undefined, serverId),
                            baseUrl: connInfo.baseUrl,
                            serverId: serverId
                        };
                        return kernel;
                    })
                );
                const mappedLive = sessions.map((s) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const liveKernel = s.kernel as any;
                    const lastActivityTime = liveKernel.last_activity
                        ? new Date(Date.parse(liveKernel.last_activity.toString()))
                        : new Date();
                    const numberOfConnections = liveKernel.connections
                        ? parseInt(liveKernel.connections.toString(), 10)
                        : 0;
                    const activeKernel = running.find((active) => active.id === s.kernel?.id) || {};
                    const matchingSpec: Partial<IJupyterKernelSpec> =
                        specs.find((spec) => spec.name === s.kernel?.name) || {};

                    const kernel: LiveRemoteKernelConnectionMetadata = {
                        kind: 'connectToLiveRemoteKernel',
                        kernelModel: {
                            ...s.kernel,
                            ...matchingSpec,
                            ...activeKernel,
                            name: s.kernel?.name || '',
                            lastActivityTime,
                            numberOfConnections,
                            model: s
                        },
                        baseUrl: connInfo.baseUrl,
                        id: s.kernel?.id || '',
                        serverId
                    };
                    return kernel;
                });

                // Filter out excluded ids
                const filtered = mappedLive.filter((k) => !this.kernelIdsToHide.has(k.kernelModel.id || ''));
                const items = [...filtered, ...mappedSpecs];
                return items;
            } catch (ex) {
                traceError(`Error fetching remote kernels:`, ex);
                throw ex;
            } finally {
                if (sessionManager) {
                    await sessionManager.dispose();
                }
            }
        }
        return [];
    }

    private async getInterpreter(spec: IJupyterKernelSpec, baseUrl: string) {
        const parsed = new URL(baseUrl);
        if (
            (parsed.hostname.toLocaleLowerCase() === 'localhost' || parsed.hostname === '127.0.0.1') &&
            this.extensionChecker.isPythonExtensionInstalled &&
            !this.isWebExtension &&
            getLanguageInKernelSpec(spec) === PYTHON_LANGUAGE
        ) {
            // Interpreter is possible. Same machine as VS code
            try {
                traceInfoIfCI(`Getting interpreter details for localhost remote kernel: ${spec.name}`);
                return await this.interpreterService.getInterpreterDetails(Uri.file(spec.argv[0]));
            } catch (ex) {
                traceError(`Failure getting interpreter details for remote kernel: `, ex);
            }
        }
    }

    private getCacheKey() {
        return RemoteKernelSpecsCacheKey;
    }

    private async writeToCache(values: RemoteKernelConnectionMetadata[]) {
        const key = this.getCacheKey();
        this.cache = values;
        const serialized = values.map(serializeKernelConnection);
        await Promise.all([
            removeOldCachedItems(this.globalState),
            this.globalState.update(key, { kernels: serialized, extensionVersion: this.env.extensionVersion })
        ]);
    }

    private async isValidCachedKernel(kernel: RemoteKernelConnectionMetadata): Promise<boolean> {
        switch (kernel.kind) {
            case 'startUsingRemoteKernelSpec':
                // Always fetch the latest kernels from remotes, no need to display cached remote kernels.
                return false;
            case 'connectToLiveRemoteKernel':
                return this.cachedRemoteKernelValidator.isValid(kernel);
        }
    }
}
