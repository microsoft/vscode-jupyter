// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import type * as nbformat from '@jupyterlab/nbformat';
import { CancellationToken } from 'vscode';
import { isPythonNotebook } from '../notebooks/helpers';
import { IPythonExtensionChecker } from '../platform/api/types';
import { PYTHON_LANGUAGE, Telemetry } from '../platform/common/constants';
import { IConfigurationService, Resource } from '../platform/common/types';
import { getResourceType } from '../platform/common/utils';
import { StopWatch } from '../platform/common/utils/stopWatch';
import { IInterpreterService } from '../platform/interpreter/contracts';
import { traceInfo, traceError, traceDecoratorVerbose } from '../platform/logging';
import { TraceOptions } from '../platform/logging/types';
import { captureTelemetry, sendTelemetryEvent } from '../telemetry';
import { getTelemetrySafeLanguage } from '../telemetry/helpers';
import { DisplayOptions } from './displayOptions';
import {
    getLanguageInNotebookMetadata,
    findPreferredKernel,
    getDisplayNameOrNameOfKernelConnection,
    isLocalLaunch
} from './helpers';
import { PreferredRemoteKernelIdProvider } from './raw/finder/preferredRemoteKernelIdProvider';
import { IKernelFinder, INotebookProvider, INotebookProviderConnection, KernelConnectionMetadata } from './types';

export abstract class BaseKernelFinder implements IKernelFinder {
    private startTimeForFetching?: StopWatch;
    private fetchingTelemetrySent = new Set<string>();

    constructor(
        private readonly extensionChecker: IPythonExtensionChecker,
        private readonly interpreterService: IInterpreterService,
        private readonly configurationService: IConfigurationService,
        private readonly preferredRemoteFinder: PreferredRemoteKernelIdProvider,
        private readonly notebookProvider: INotebookProvider
    ) {}

    // Finding a kernel is the same no matter what the source
    @traceDecoratorVerbose('Find kernel spec', TraceOptions.BeforeCall | TraceOptions.Arguments)
    @captureTelemetry(Telemetry.KernelFinderPerf)
    public async findKernel(
        resource: Resource,
        notebookMetadata?: nbformat.INotebookMetadata,
        cancelToken?: CancellationToken
    ): Promise<KernelConnectionMetadata | undefined> {
        const resourceType = getResourceType(resource);
        const telemetrySafeLanguage =
            resourceType === 'interactive'
                ? PYTHON_LANGUAGE
                : getTelemetrySafeLanguage(getLanguageInNotebookMetadata(notebookMetadata) || '');
        try {
            // Get list of all of the specs from the cache and without the cache (note, cached items will be validated before being returned)
            const cached = await this.listKernels(resource, cancelToken, 'useCache');
            const nonCachedPromise = this.listKernels(resource, cancelToken, 'ignoreCache');

            const isPythonNbOrInteractiveWindow = isPythonNotebook(notebookMetadata) || resourceType === 'interactive';
            // Always include the interpreter in the search if we can
            const preferredInterpreter =
                isPythonNbOrInteractiveWindow && this.extensionChecker.isPythonExtensionInstalled
                    ? await this.interpreterService.getActiveInterpreter(resource)
                    : undefined;

            // Find the preferred kernel index from the list.
            let preferred = findPreferredKernel(
                cached,
                resource,
                notebookMetadata,
                preferredInterpreter,
                this.preferredRemoteFinder
            );

            // If still not found, try the nonCached list
            if (!preferred) {
                preferred = findPreferredKernel(
                    await nonCachedPromise,
                    resource,
                    notebookMetadata,
                    preferredInterpreter,
                    this.preferredRemoteFinder
                );
            }
            sendTelemetryEvent(Telemetry.PreferredKernel, undefined, {
                result: preferred ? 'found' : 'notfound',
                resourceType,
                language: telemetrySafeLanguage,
                hasActiveInterpreter: !!preferredInterpreter
            });
            if (preferred) {
                traceInfo(`findKernel found ${getDisplayNameOrNameOfKernelConnection(preferred)}`);
                return preferred;
            }
        } catch (ex) {
            sendTelemetryEvent(
                Telemetry.PreferredKernel,
                undefined,
                {
                    result: 'failed',
                    resourceType,
                    language: telemetrySafeLanguage
                },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ex as any,
                true
            );
            traceError(`findKernel crashed`, ex);
            return undefined;
        }
    }

    public async listKernels(
        resource: Resource,
        cancelToken?: CancellationToken,
        useCache?: 'ignoreCache' | 'useCache'
    ): Promise<KernelConnectionMetadata[]> {
        this.startTimeForFetching = this.startTimeForFetching ?? new StopWatch();
        let connInfo = isLocalLaunch(this.configurationService) ? undefined : await this.getConnectionInfo(cancelToken);

        // Wrap an exceptions. It can fail? not sure why though
        return this.listKernelsImpl(resource, connInfo, cancelToken, useCache).catch((ex) => {
            traceError('Failed to get kernel connections', ex);
            return [] as KernelConnectionMetadata[];
        });
    }

    // Listing kernels is handled by the node or web versions
    protected abstract listKernelsImpl(
        resource: Resource,
        connInfo: INotebookProviderConnection | undefined,
        cancelToken?: CancellationToken,
        useCache?: 'ignoreCache' | 'useCache'
    ): Promise<KernelConnectionMetadata[]>;

    protected finishListingKernels(
        list: KernelConnectionMetadata[],
        useCache: 'ignoreCache' | 'useCache',
        kind: 'local' | 'remote'
    ) {
        // Send the telemetry once for each type of search
        const key = `${kind}:${useCache}`;
        if (this.startTimeForFetching && !this.fetchingTelemetrySent.has(key)) {
            this.fetchingTelemetrySent.add(key);
            sendTelemetryEvent(Telemetry.FetchControllers, this.startTimeForFetching.elapsedTime, {
                cached: useCache === 'useCache',
                kind
            });
        }

        // Just return the list
        return list;
    }

    private async getConnectionInfo(cancelToken?: CancellationToken): Promise<INotebookProviderConnection | undefined> {
        const ui = new DisplayOptions(false);
        return this.notebookProvider.connect({
            resource: undefined,
            ui,
            kind: 'remoteJupyter',
            token: cancelToken
        });
    }
}
