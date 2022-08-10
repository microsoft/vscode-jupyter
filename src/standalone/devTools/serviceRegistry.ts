// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { IExtensionContext } from '../../platform/common/types';
import { IServiceManager } from '../../platform/ioc/types';
import { addClearCacheCommand } from './clearCache';

export function registerTypes(context: IExtensionContext, _serviceManager: IServiceManager, isDevMode: boolean) {
    addClearCacheCommand(context, isDevMode);
}
