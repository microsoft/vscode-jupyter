// This class searches for a kernel that matches the given kernel name.
// First it searches on a global persistent state, then on the installed python interpreters,

import { Kernel } from '@jupyterlab/services';
import { nbformat } from '@jupyterlab/coreutils';
import { injectable, inject } from 'inversify';
import { CancellationToken } from 'vscode';
import { IDisposableRegistry, Resource } from '../../common/types';
import { traceDecorators } from '../../logging';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { captureTelemetry } from '../../telemetry';
import { Telemetry } from '../constants';
import { findPreferredKernelIndex } from '../jupyter/kernels/helpers';
import {
    KernelConnectionMetadata,
    DefaultKernelConnectionMetadata,
    LiveKernelConnectionMetadata
} from '../jupyter/kernels/types';
import { PreferredRemoteKernelIdProvider } from '../notebookStorage/preferredRemoteKernelIdProvider';
import {
    IJupyterKernelSpec,
    IJupyterSessionManager,
    IJupyterSessionManagerFactory,
    INotebookProviderConnection
} from '../types';
import { isInterpreter } from './localKernelFinder';
import { IRemoteKernelFinder } from './types';

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
    public async findKernel(
        resource: Resource,
        connInfo: INotebookProviderConnection | undefined,
        option?: nbformat.INotebookMetadata | PythonEnvironment,
        _cancelToken?: CancellationToken
    ): Promise<KernelConnectionMetadata | undefined> {
        // Get list of all of the specs
        const kernels = await this.listKernels(resource, connInfo);

        // Find the preferred kernel index from the list.
        const notebookMetadata = option && !isInterpreter(option) ? option : undefined;
        const preferred = findPreferredKernelIndex(
            kernels,
            resource,
            [],
            notebookMetadata,
            undefined,
            this.preferredRemoteKernelIdProvider
        );
        if (preferred >= 0) {
            return kernels[preferred];
        }
    }

    // Talk to the remote server to determine sessions
    @captureTelemetry(Telemetry.KernelListingPerf)
    public async listKernels(
        _resource: Resource,
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
                    const kernel: DefaultKernelConnectionMetadata = {
                        kind: 'startUsingDefaultKernel',
                        kernelSpec: s
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
                    const activeKernel = running.find((active) => active.id === s.kernel.id) || {};
                    const matchingSpec: Partial<IJupyterKernelSpec> =
                        specs.find((spec) => spec.name === s.kernel.name) || {};

                    const kernel: LiveKernelConnectionMetadata = {
                        kind: 'connectToLiveKernel',
                        kernelModel: {
                            ...s.kernel,
                            ...matchingSpec,
                            ...activeKernel,
                            lastActivityTime,
                            numberOfConnections,
                            session: s
                        }
                    };
                    return kernel;
                });

                // Filter out excluded ids
                const filtered = mappedLive.filter(
                    (k) => k.kind !== 'connectToLiveKernel' || !this.kernelIdsToHide.has(k.kernelModel.id || '')
                );

                return [...filtered, ...mappedSpecs];
            } finally {
                if (sessionManager) {
                    await sessionManager.dispose();
                }
            }
        }
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
