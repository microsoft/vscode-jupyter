// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { IExtensionSingleActivationService, IExtensionSyncActivationService } from '../activation/types';
import { IServiceManager } from '../ioc/types';
import { InterpreterCountTracker } from './interpreterCountTracker';
import { WorkspaceInterpreterTracker } from './workspaceInterpreterTracker';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        WorkspaceInterpreterTracker
    );
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        InterpreterCountTracker
    );
}
