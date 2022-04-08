// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { IExtensionContext } from '../common/types';
import { IServiceManager } from '../ioc/types';
import { addClearCacheCommand } from './clearCache';

export function registerTypes(context: IExtensionContext, _serviceManager: IServiceManager, isDevMode: boolean) {
    addClearCacheCommand(context, isDevMode);
}
