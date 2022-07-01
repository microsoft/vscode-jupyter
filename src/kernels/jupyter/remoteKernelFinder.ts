// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { injectable, inject } from 'inversify';
import { CancellationToken, Uri } from 'vscode';
import { getKernelId } from '../helpers';
import {
    IJupyterKernelSpec,
    INotebookProviderConnection,
    KernelConnectionMetadata,
    LiveRemoteKernelConnectionMetadata,
    RemoteKernelSpecConnectionMetadata
} from '../types';
import { IsWebExtension, Resource } from '../../platform/common/types';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import { captureTelemetry, Telemetry } from '../../telemetry';
import { IRemoteKernelFinder } from '../raw/types';
import { IJupyterSessionManagerFactory, IJupyterSessionManager } from './types';
import { sendKernelSpecTelemetry } from '../raw/finder/helper';
import { traceError, traceInfoIfCI } from '../../platform/logging';
import { IPythonExtensionChecker } from '../../platform/api/types';
import { computeServerId } from './jupyterUtils';

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
        @inject(IJupyterSessionManagerFactory) private jupyterSessionManagerFactory: IJupyterSessionManagerFactory,
        @inject(IInterpreterService) private interpreterService: IInterpreterService,
        @inject(IPythonExtensionChecker) private extensionChecker: IPythonExtensionChecker,
        @inject(IsWebExtension) private isWebExtension: boolean
    ) {}

    // Talk to the remote server to determine sessions
    @captureTelemetry(Telemetry.KernelListingPerf, { kind: 'remote' })
    public async listKernels(
        _resource: Resource,
        connInfo: INotebookProviderConnection,
        _cancelToken: CancellationToken
    ): Promise<KernelConnectionMetadata[]> {
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
            !this.isWebExtension
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
}
