// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, optional } from 'inversify';
import { IKernelSession, IKernelSessionFactory, isLocalConnection, KernelSessionCreationOptions } from '../types';
import { IRawKernelSessionFactory, IOldRawKernelSessionFactory, IRawNotebookSupportedService } from '../raw/types';
import { JupyterKernelSessionFactory } from '../jupyter/session/jupyterKernelSessionFactory';
import { Experiments, IExperimentService } from '../../platform/common/types';
import { OldJupyterKernelSessionFactory } from '../jupyter/session/oldJupyterKernelSessionFactory';

/**
 * Generic class for connecting to a server. Probably could be renamed as it doesn't provide notebooks, but rather connections.
 */
@injectable()
export class KernelSessionFactory implements IKernelSessionFactory {
    constructor(
        @inject(IRawNotebookSupportedService)
        private readonly rawKernelSupported: IRawNotebookSupportedService,

        @inject(IOldRawKernelSessionFactory)
        @optional()
        private readonly rawKernelSessionFactory: IOldRawKernelSessionFactory | undefined,
        @inject(OldJupyterKernelSessionFactory)
        private readonly jupyterSessionFactory: IKernelSessionFactory,
        @inject(IRawKernelSessionFactory)
        @optional()
        private readonly newRawKernelSessionFactory: IRawKernelSessionFactory | undefined,
        @inject(JupyterKernelSessionFactory)
        private readonly newJupyterSessionFactory: IKernelSessionFactory,
        @inject(IExperimentService)
        private readonly experiments: IExperimentService
    ) {}

    public async create(options: KernelSessionCreationOptions): Promise<IKernelSession> {
        const kernelConnection = options.kernelConnection;
        if (
            this.rawKernelSupported.isSupported &&
            isLocalConnection(kernelConnection) &&
            this.rawKernelSessionFactory &&
            this.newRawKernelSessionFactory
        ) {
            return this.experiments.inExperiment(Experiments.NewJupyterSession)
                ? this.newRawKernelSessionFactory.create({ ...options, kernelConnection: kernelConnection })
                : this.rawKernelSessionFactory.create(options);
        } else {
            return this.experiments.inExperiment(Experiments.NewJupyterSession)
                ? this.newJupyterSessionFactory.create(options)
                : this.jupyterSessionFactory.create(options);
        }
    }
}
