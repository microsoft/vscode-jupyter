// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { IExtensionApi } from '../platform/api';
import { IServiceContainer, IServiceManager } from '../platform/ioc/types';

export interface IExtensionTestApi extends IExtensionApi {
    serviceContainer: IServiceContainer;
    serviceManager: IServiceManager;
}
