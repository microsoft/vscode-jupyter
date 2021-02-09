// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { IExtensionSyncActivationService } from '../../activation/types';
import { IServiceManager } from '../../ioc/types';
import { ActiveEditorContextService } from './activeEditorContext';
import { WorkspaceInterpreterTracker } from './workspaceInterpreterTracker';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<ActiveEditorContextService>(ActiveEditorContextService, ActiveEditorContextService);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        WorkspaceInterpreterTracker
    );
}
