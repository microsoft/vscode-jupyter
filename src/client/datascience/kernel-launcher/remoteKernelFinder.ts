// This class searches for a kernel that matches the given kernel name.
// First it searches on a global persistent state, then on the installed python interpreters,

import { nbformat } from '@jupyterlab/coreutils';
import { injectable, inject } from 'inversify';
import { CancellationToken } from 'vscode';
import { IPythonExtensionChecker } from '../../api/types';
import { Resource } from '../../common/types';
import { IInterpreterService } from '../../interpreter/contracts';
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
    constructor(
        @inject(IInterpreterService) private interpreterService: IInterpreterService,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(PreferredRemoteKernelIdProvider)
        private readonly preferredRemoteKernelIdProvider: PreferredRemoteKernelIdProvider,
        @inject(IJupyterSessionManagerFactory) private jupyterSessionManagerFactory: IJupyterSessionManagerFactory
    ) {}
    @traceDecorators.verbose('Find kernel spec')
    @captureTelemetry(Telemetry.KernelFinderPerf, { type: 'remote' })
    public async findKernel(
        resource: Resource,
        connInfo: INotebookProviderConnection | undefined,
        option?: nbformat.INotebookMetadata | PythonEnvironment,
        _cancelToken?: CancellationToken
    ): Promise<KernelConnectionMetadata | undefined> {
        // Get list of all of the specs
        const kernels = await this.listKernels(resource, connInfo);

        // Always include the interpreter in the search if we can
        const interpreter =
            option && isInterpreter(option)
                ? option
                : resource && this.extensionChecker.isPythonExtensionInstalled
                ? await this.interpreterService.getActiveInterpreter(resource)
                : undefined;

        // Find the preferred kernel index from the list.
        const notebookMetadata = option && !isInterpreter(option) ? option : undefined;
        const preferred = findPreferredKernelIndex(
            kernels,
            resource,
            [],
            notebookMetadata,
            interpreter,
            this.preferredRemoteKernelIdProvider
        );
        if (preferred >= 0) {
            return kernels[preferred];
        }
    }

    // Talk to the remote server to determine sessions
    @captureTelemetry(Telemetry.KernelListingPerf, { type: 'remote' })
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
                return [...mappedLive, ...mappedSpecs];
            } finally {
                if (sessionManager) {
                    sessionManager.dispose();
                }
            }
        }
        return [];
    }
}
