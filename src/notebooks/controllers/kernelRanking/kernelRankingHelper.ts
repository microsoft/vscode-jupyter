// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { INotebookMetadata } from '@jupyterlab/nbformat';
import { inject, injectable } from 'inversify';
import { CancellationToken } from 'vscode';
import { PreferredRemoteKernelIdProvider } from '../../../kernels/jupyter/preferredRemoteKernelIdProvider';
import { isLocalConnection, KernelConnectionMetadata } from '../../../kernels/types';
import { Resource } from '../../../platform/common/types';
import { ignoreLogging, logValue, traceDecoratorVerbose, traceError } from '../../../platform/logging';
import { TraceOptions } from '../../../platform/logging/types';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { capturePerfTelemetry, Telemetry } from '../../../telemetry';
import { isExactMatch, rankKernels } from './helpers';
import { IKernelRankingHelper } from '../types';

@injectable()
export class KernelRankingHelper implements IKernelRankingHelper {
    constructor(
        @inject(PreferredRemoteKernelIdProvider) private readonly preferredRemoteFinder: PreferredRemoteKernelIdProvider
    ) {}

    @traceDecoratorVerbose('Rank Kernels', TraceOptions.BeforeCall | TraceOptions.Arguments)
    @capturePerfTelemetry(Telemetry.RankKernelsPerf)
    public async rankKernels(
        resource: Resource,
        @ignoreLogging() kernels: KernelConnectionMetadata[],
        notebookMetadata?: INotebookMetadata | undefined,
        @logValue<PythonEnvironment>('uri') preferredInterpreter?: PythonEnvironment,
        @ignoreLogging() cancelToken?: CancellationToken,
        serverId?: string
    ): Promise<KernelConnectionMetadata[] | undefined> {
        try {
            // Get list of all of the specs from the cache and without the cache (note, cached items will be validated before being returned)
            if (serverId) {
                kernels = kernels.filter((kernel) => !isLocalConnection(kernel) && kernel.serverId === serverId);
            }
            const preferredRemoteKernelId =
                resource && this.preferredRemoteFinder
                    ? await this.preferredRemoteFinder.getPreferredRemoteKernelId(resource)
                    : undefined;
            if (cancelToken?.isCancellationRequested) {
                return;
            }
            let rankedKernels = await rankKernels(
                kernels,
                resource,
                notebookMetadata,
                preferredInterpreter,
                preferredRemoteKernelId,
                cancelToken
            );

            return rankedKernels;
        } catch (ex) {
            traceError(`RankKernels crashed`, ex);
            return undefined;
        }
    }

    public async isExactMatch(
        resource: Resource,
        kernelConnection: KernelConnectionMetadata,
        notebookMetadata: INotebookMetadata | undefined
    ): Promise<boolean> {
        const preferredRemoteKernelId =
            resource && this.preferredRemoteFinder
                ? await this.preferredRemoteFinder.getPreferredRemoteKernelId(resource)
                : undefined;

        return isExactMatch(kernelConnection, notebookMetadata, preferredRemoteKernelId);
    }
}
