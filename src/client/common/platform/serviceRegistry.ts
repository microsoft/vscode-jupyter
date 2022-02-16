// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { IServiceManager } from '../../ioc/types';
import { IWebviewViewProvider } from '../application/types';
import { WebviewViewProvider } from '../application/webviewViews/webviewViewProvider';
import { PlatformService } from './platformService';
import { IPlatformService } from './types';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<IPlatformService>(IPlatformService, PlatformService);
    serviceManager.add<IWebviewViewProvider>(IWebviewViewProvider, WebviewViewProvider);
}
