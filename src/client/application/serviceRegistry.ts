// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { IExtensionSingleActivationService } from '../activation/types';
import { IServiceManager } from '../ioc/types';
import { SourceMapSupportService } from './diagnostics/surceMapSupportService';
import { ISourceMapSupportService } from './diagnostics/types';
import { JoinMailingListPrompt } from './misc/joinMailingListPrompt';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<ISourceMapSupportService>(ISourceMapSupportService, SourceMapSupportService);
    serviceManager.add<IExtensionSingleActivationService>(IExtensionSingleActivationService, JoinMailingListPrompt);
}
