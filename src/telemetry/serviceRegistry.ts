// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { IExtensionSingleActivationService, IExtensionSyncActivationService } from '../platform/activation/types';
import { IServiceManager } from '../platform/ioc/types';
import { ActiveEditorContextService } from '../platform/../interactive-window/commands/activeEditorContext';
import { InterpreterCountTracker } from './interpreterCountTracker';
import { InterpreterPackages } from './interpreterPackages';
import { InterpreterPackageTracker } from './interpreterPackageTracker';
import { WorkspaceInterpreterTracker } from './workspaceInterpreterTracker';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<ActiveEditorContextService>(ActiveEditorContextService, ActiveEditorContextService);
    serviceManager.addSingleton<InterpreterPackages>(InterpreterPackages, InterpreterPackages);
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
