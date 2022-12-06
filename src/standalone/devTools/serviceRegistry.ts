// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { IExtensionContext } from '../../platform/common/types';
import { addClearCacheCommand } from './clearCache';

export function registerTypes(context: IExtensionContext, isDevMode: boolean) {
    addClearCacheCommand(context, isDevMode);
}
