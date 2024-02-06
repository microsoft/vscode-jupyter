// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IPythonApiProvider, PythonApi } from '../../../platform/api/types';
import { IServiceContainer } from '../../../platform/ioc/types';

let registered = false;
export function registerPythonApi(pythonApi: PythonApi, serviceContainer: IServiceContainer) {
    if (registered) {
        return;
    }
    registered = true;
    const apiProvider = serviceContainer.get<IPythonApiProvider>(IPythonApiProvider);
    apiProvider.setApi(pythonApi);
}
