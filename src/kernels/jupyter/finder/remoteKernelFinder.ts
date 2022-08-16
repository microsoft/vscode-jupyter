// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { injectable, inject, named } from 'inversify';
import { CancellationToken, Memento, Uri } from 'vscode';
import { getKernelId, getLanguageInKernelSpec, serializeKernelConnection } from '../../helpers';
import {
    IJupyterKernelSpec,
    IKernelFinder,
    INotebookProvider,
    INotebookProviderConnection,
    KernelConnectionMetadata,
    LiveRemoteKernelConnectionMetadata,
    RemoteKernelConnectionMetadata,
    RemoteKernelSpecConnectionMetadata
} from '../../types';
import { GLOBAL_MEMENTO, IMemento, IsWebExtension, Resource } from '../../../platform/common/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { captureTelemetry, Telemetry } from '../../../telemetry';
import {
    IJupyterSessionManagerFactory,
    IJupyterSessionManager,
    IJupyterServerUriStorage,
    IServerConnectionType,
    IJupyterRemoteCachedKernelValidator,
    IRemoteKernelFinder
} from '../types';
import { sendKernelSpecTelemetry } from '../../raw/finder/helper';
import { traceError, traceWarning, traceInfoIfCI, traceVerbose } from '../../../platform/logging';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { computeServerId } from '../jupyterUtils';
import { PYTHON_LANGUAGE } from '../../../platform/common/constants';
import { createPromiseFromCancellation, isCancellationError } from '../../../platform/common/cancellation';
import { DisplayOptions } from '../../displayOptions';
import { isArray } from '../../../platform/common/utils/sysTypes';
import { deserializeKernelConnection } from '../../helpers';
import { createDeferredFromPromise } from '../../../platform/common/utils/async';
import { noop } from '../../../platform/common/utils/misc';
import { IApplicationEnvironment } from '../../../platform/common/application/types';
import { KernelFinder } from '../../kernelFinder';
import { RemoteKernelSpecsCacheKey, removeOldCachedItems } from '../../common/commonFinder';
import { IExtensionSingleActivationService } from '../../../platform/activation/types';

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
    private cache: RemoteKernelConnectionMetadata[] = [];

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
        @inject(IsWebExtension) private isWebExtension: boolean
    ) {
        kernelFinder.registerKernelFinder(this);
    }

    async activate(): Promise<void> {
        noop();
    }

    async listContributedKernels(
        resource: Resource,
        cancelToken: CancellationToken | undefined,
        useCache: 'ignoreCache' | 'useCache'
    ): Promise<KernelConnectionMetadata[]> {
        const kernels: KernelConnectionMetadata[] = await this.listKernelsImpl(resource, cancelToken, useCache).catch(
            (ex) => {
                // Sometimes we can get errors from the socket level or jupyter, with the message 'Canceled', lets ignore those
                if (!isCancellationError(ex, true)) {
                    traceError('Failed to get remote kernels', ex);
                }
                return [];
            }
        );

        traceVerbose(`KernelFinder discovered ${kernels.length} remote`);
        return kernels;
    }

    private async listKernelsImpl(
        resource: Resource,
        cancelToken: CancellationToken | undefined,
        useCache: 'ignoreCache' | 'useCache'
    ) {
        if (this.serverConnectionType.isLocalLaunch) {
            return [];
        }

        const kernelsFromCachePromise =
            useCache === 'ignoreCache' ? Promise.resolve([]) : this.getFromCache(cancelToken);
        let updateCache = true;
        const kernelsWithoutCachePromise = (async () => {
            const connInfo = await this.getRemoteConnectionInfo(cancelToken);
            return connInfo ? this.listKernelsFromConnection(resource, connInfo) : Promise.resolve([]);
        })();
        let kernels: RemoteKernelConnectionMetadata[] = [];
        if (useCache === 'ignoreCache') {
            try {
                kernels = await kernelsWithoutCachePromise;
            } catch (ex) {
                traceWarning(`Could not fetch kernels from the ${this.kind} server, falling back to cache: ${ex}`);
                // Since fetching the remote kernels failed, we fall back to the cache,
                // at this point no need to display all of the kernel specs,
                // Its possible the connection is dead, just display the live kernels we had.
                // I.e. if user had a notebook connected to a remote kernel, then just display that live kernel.
                kernels = await this.getFromCache(cancelToken);
                kernels = kernels.filter((item) => item.kind === 'connectToLiveRemoteKernel');
                updateCache = false;
            }
        } else {
            let kernelsFromCache: RemoteKernelConnectionMetadata[] | undefined;
            kernelsFromCachePromise
                .then((items) => {
                    kernelsFromCache = items;
                    updateCache = false;
                })
                .catch(noop);

            try {
                const kernelsWithoutCacheDeferred = createDeferredFromPromise(kernelsWithoutCachePromise);
                try {
                    await Promise.race([kernelsFromCachePromise, kernelsWithoutCacheDeferred.promise]);
                } catch (ex) {
                    // If we failed to get without cache, then await on the cache promise as a fallback.
                    if (kernelsWithoutCacheDeferred.rejected) {
                        await kernelsFromCachePromise;
                    } else {
                        throw ex;
                    }
                }
                // If we finish the cache first, and we don't have any items, in the cache, then load without cache.
                if (Array.isArray(kernelsFromCache) && kernelsFromCache.length > 0) {
                    kernels = kernelsFromCache;
                } else {
                    kernels = await kernelsWithoutCachePromise;
                    updateCache = true;
                }
            } catch (ex) {
                traceError(`Exception loading kernels: ${ex}`);
            }
        }

        // Do not update the cache if we got kernels from the cache.
        if (updateCache) {
            await this.writeToCache(kernels);
        }
        return kernels;
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
    @captureTelemetry(Telemetry.KernelListingPerf, { kind: 'remote' })
    public async listKernelsFromConnection(
        _resource: Resource,
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
