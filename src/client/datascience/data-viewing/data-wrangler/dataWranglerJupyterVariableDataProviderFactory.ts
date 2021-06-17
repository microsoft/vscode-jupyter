// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../../common/extensions';

import { inject, injectable } from 'inversify';

import { IServiceContainer } from '../../../ioc/types';
import { IJupyterVariable, INotebook } from '../../types';
import { IDataWranglerJupyterVariableDataProvider, IDataWranglerJupyterVariableDataProviderFactory } from './types';

@injectable()
export class DataWranglerJupyterVariableDataProviderFactory implements IDataWranglerJupyterVariableDataProviderFactory {
    constructor(@inject(IServiceContainer) private serviceContainer: IServiceContainer) {}

    public async create(
        variable: IJupyterVariable,
        notebook?: INotebook
    ): Promise<IDataWranglerJupyterVariableDataProvider> {
        const dataWranglerJupyterVariableDataProvider = this.serviceContainer.get<
            IDataWranglerJupyterVariableDataProvider
        >(IDataWranglerJupyterVariableDataProvider);
        dataWranglerJupyterVariableDataProvider.setDependencies(variable, notebook);
        return dataWranglerJupyterVariableDataProvider;
    }
}
