// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, optional } from 'inversify';
import { IKernelSession, IKernelSessionFactory, isLocalConnection, KernelSessionCreationOptions } from '../types';
import { INewRawKernelSessionFactory, IRawKernelSessionFactory, IRawNotebookSupportedService } from '../raw/types';
import {
    JupyterKernelSessionFactory,
    NewJupyterKernelSessionFactory
} from '../jupyter/session/jupyterKernelSessionFactory';
import { Experiments, IExperimentService } from '../../platform/common/types';

/**
 * Generic class for connecting to a server. Probably could be renamed as it doesn't provide notebooks, but rather connections.
 */
@injectable()
export class KernelSessionFactory implements IKernelSessionFactory {
    constructor(
        @inject(IRawNotebookSupportedService)
        private readonly rawKernelSupported: IRawNotebookSupportedService,

        @inject(IRawKernelSessionFactory)
        @optional()
        private readonly rawKernelSessionFactory: IRawKernelSessionFactory | undefined,
        @inject(INewRawKernelSessionFactory)
        @optional()
        private readonly newRawKernelSessionFactory: INewRawKernelSessionFactory | undefined,
        @inject(JupyterKernelSessionFactory)
        private readonly jupyterSessionFactory: IKernelSessionFactory,
        @inject(NewJupyterKernelSessionFactory)
        private readonly newJupyterSessionFactory: NewJupyterKernelSessionFactory,
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
