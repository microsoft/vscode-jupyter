// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { IWebviewViewProvider } from '../../platform/common/application/types';
import { IServiceManager } from '../../platform/ioc/types';
import { WebviewViewProvider } from './webviewViews/webviewViewProvider.web';

export function registerTypes(serviceManager: IServiceManager, _isDevMode: boolean) {
    serviceManager.add<IWebviewViewProvider>(IWebviewViewProvider, WebviewViewProvider);
}
