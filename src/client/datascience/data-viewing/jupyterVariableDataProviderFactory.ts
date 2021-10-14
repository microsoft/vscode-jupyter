// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../common/extensions';

import { inject, injectable } from 'inversify';

import { IServiceContainer } from '../../ioc/types';
import { IJupyterVariable, IJupyterVariableDataProvider, IJupyterVariableDataProviderFactory } from '../types';
import { IKernel } from '../jupyter/kernels/types';

@injectable()
export class JupyterVariableDataProviderFactory implements IJupyterVariableDataProviderFactory {
    constructor(@inject(IServiceContainer) private serviceContainer: IServiceContainer) {}

    public async create(variable: IJupyterVariable, kernel?: IKernel): Promise<IJupyterVariableDataProvider> {
        const jupyterVariableDataProvider = this.serviceContainer.get<IJupyterVariableDataProvider>(
            IJupyterVariableDataProvider
        );
        jupyterVariableDataProvider.setDependencies(variable, kernel);
        return jupyterVariableDataProvider;
    }
}
