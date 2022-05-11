// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { IExtensionSingleActivationService, IExtensionSyncActivationService } from '../platform/activation/types';
import { IServiceManager } from '../platform/ioc/types';
import { InterpreterCountTracker } from './interpreterCountTracker';
import { InterpreterPackages } from './interpreterPackages.node';
import { InterpreterPackageTracker } from './interpreterPackageTracker';
import { WorkspaceInterpreterTracker } from './workspaceInterpreterTracker';
import { IInterpreterPackages } from './types';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<IInterpreterPackages>(IInterpreterPackages, InterpreterPackages);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        WorkspaceInterpreterTracker
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        InterpreterPackageTracker
    );
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        InterpreterCountTracker
    );
}
