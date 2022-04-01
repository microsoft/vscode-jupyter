// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { IServiceManager } from '../ioc/types';
import { ExtensionActivationManager } from './activationManager';

import { IExtensionActivationManager } from './types';

// eslint-disable-next-line
export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.add<IExtensionActivationManager>(IExtensionActivationManager, ExtensionActivationManager);
}
