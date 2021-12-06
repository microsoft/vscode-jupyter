// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { Kernel } from '@jupyterlab/services';
import type * as nbformat from '@jupyterlab/nbformat';
import { injectable, inject } from 'inversify';
import { CancellationToken } from 'vscode';
import { IDisposableRegistry, Resource } from '../../common/types';
import { traceDecorators } from '../../logging';
import { captureTelemetry, sendTelemetryEvent } from '../../telemetry';
import { Telemetry } from '../constants';
import { findPreferredKernel, getKernelId, getLanguageInNotebookMetadata } from '../jupyter/kernels/helpers';
import {
    KernelConnectionMetadata,
    LiveKernelConnectionMetadata,
    RemoteKernelSpecConnectionMetadata
} from '../jupyter/kernels/types';
import { PreferredRemoteKernelIdProvider } from '../notebookStorage/preferredRemoteKernelIdProvider';
import {
    IJupyterKernelSpec,
    IJupyterSessionManager,
    IJupyterSessionManagerFactory,
    INotebookProviderConnection
} from '../types';
import { IRemoteKernelFinder } from './types';
import { traceError, traceInfoIfCI } from '../../common/logger';
import { getResourceType } from '../common';
import { PYTHON_LANGUAGE } from '../../common/constants';
import { getTelemetrySafeLanguage } from '../../telemetry/helpers';
import { sendKernelListTelemetry } from '../telemetry/kernelTelemetry';
import { ignoreLogging } from '../../logging/trace';

// This class searches for a kernel that matches the given kernel name.
// First it searches on a global persistent state, then on the installed python interpreters,
// and finally on the default locations that jupyter installs kernels on.
@injectable()
export class RemoteKernelFinder implements IRemoteKernelFinder {
    /**
     * List of ids of kernels that should be hidden from the kernel picker.
     */
    private readonly kernelIdsToHide = new Set<string>();
    constructor(
        @inject(IDisposableRegistry) disposableRegistry: IDisposableRegistry,
        @inject(PreferredRemoteKernelIdProvider)
        private readonly preferredRemoteKernelIdProvider: PreferredRemoteKernelIdProvider,
        @inject(IJupyterSessionManagerFactory) private jupyterSessionManagerFactory: IJupyterSessionManagerFactory
    ) {
        disposableRegistry.push(
            this.jupyterSessionManagerFactory.onRestartSessionCreated(this.addKernelToIgnoreList.bind(this))
        );
        disposableRegistry.push(
            this.jupyterSessionManagerFactory.onRestartSessionUsed(this.removeKernelFromIgnoreList.bind(this))
        );
    }
    @traceDecorators.verbose('Find remote kernel spec')
    @captureTelemetry(Telemetry.KernelFinderPerf)
    @captureTelemetry(Telemetry.KernelListingPerf, { kind: 'remote' })
    public async findKernel(
        resource: Resource,
        connInfo: INotebookProviderConnection | undefined,
        notebookMetadata?: nbformat.INotebookMetadata,
        @ignoreLogging() _cancelToken?: CancellationToken
    ): Promise<KernelConnectionMetadata | undefined> {
        const resourceType = getResourceType(resource);
        const telemetrySafeLanguage =
            resourceType === 'interactive'
                ? PYTHON_LANGUAGE
                : getTelemetrySafeLanguage(getLanguageInNotebookMetadata(notebookMetadata) || '');
        try {
            // Get list of all of the specs
            const kernels = await this.listKernels(resource, connInfo);

            // Find the preferred kernel index from the list.
            const preferred = findPreferredKernel(
                kernels,
                resource,
                [],
                notebookMetadata,
                undefined,
                this.preferredRemoteKernelIdProvider
            );
            sendTelemetryEvent(Telemetry.PreferredKernel, undefined, {
                result: preferred ? 'found' : 'notfound',
                resourceType,
                language: telemetrySafeLanguage
            });
            return preferred;
        } catch (ex) {
            sendTelemetryEvent(
                Telemetry.PreferredKernel,
                undefined,
                { result: 'failed', resourceType, language: telemetrySafeLanguage },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ex as any,
                true
            );
            traceError(`findKernel crashed`, ex);
        }
    }

    // Talk to the remote server to determine sessions
    public async listKernels(
        resource: Resource,
        connInfo: INotebookProviderConnection | undefined
    ): Promise<KernelConnectionMetadata[]> {
        // Get a jupyter session manager to talk to
        let sessionManager: IJupyterSessionManager | undefined;

        // This should only be used when doing remote.
        if (connInfo && connInfo.type === 'jupyter') {
            try {
                sessionManager = await this.jupyterSessionManagerFactory.create(connInfo);

                // Get running and specs at the same time
                const [running, specs, sessions] = await Promise.all([
                    sessionManager.getRunningKernels(),
                    sessionManager.getKernelSpecs(),
                    sessionManager.getRunningSessions()
                ]);

                // Turn them both into a combined list
                const mappedSpecs = specs.map((s) => {
                    const kernel: RemoteKernelSpecConnectionMetadata = {
                        kind: 'startUsingRemoteKernelSpec',
                        kernelSpec: s,
                        id: getKernelId(s, undefined),
                        baseUrl: connInfo.baseUrl
                    };
                    return kernel;
                });
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

                    const kernel: LiveKernelConnectionMetadata = {
                        kind: 'connectToLiveKernel',
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
                        id: s.kernel?.id || ''
                    };
                    return kernel;
                });

                // Filter out excluded ids
                const filtered = mappedLive.filter((k) => !this.kernelIdsToHide.has(k.kernelModel.id || ''));
                const items = [...filtered, ...mappedSpecs];
                traceInfoIfCI(
                    `Kernel specs for ${resource?.toString() || 'undefined'} are \n ${JSON.stringify(
                        items,
                        undefined,
                        4
                    )}`
                );

                sendKernelListTelemetry(resource, items);
                return items;
            } finally {
                if (sessionManager) {
                    await sessionManager.dispose();
                }
            }
        }
        sendKernelListTelemetry(resource, []);
        return [];
    }

    /**
     * Ensure kernels such as those associated with the restart session are not displayed in the kernel picker.
     */
    private addKernelToIgnoreList(kernel: Kernel.IKernelConnection): void {
        this.kernelIdsToHide.add(kernel.id);
        this.kernelIdsToHide.add(kernel.clientId);
    }
    /**
     * Opposite of the add counterpart.
     */
    private removeKernelFromIgnoreList(kernel: Kernel.IKernelConnection): void {
        this.kernelIdsToHide.delete(kernel.id);
        this.kernelIdsToHide.delete(kernel.clientId);
    }
}
