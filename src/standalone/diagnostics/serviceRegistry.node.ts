// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IServiceManager } from '../../platform/ioc/types';
import { ReservedFileNamesDiagnosticProvider } from './reservedFileNameDiagnostics.node';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        ReservedFileNamesDiagnosticProvider
    );
}
