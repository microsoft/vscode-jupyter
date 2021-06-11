// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { IServiceManager } from '../../ioc/types';
import { IWebviewPanelProvider, IWebviewViewProvider } from '../application/types';
import { WebviewPanelProvider } from '../application/webviewPanels/webviewPanelProvider';
import { WebviewViewProvider } from '../application/webviewViews/webviewViewProvider';
import { DataScienceProductPathService } from './productPath';
import { IProductPathService } from './types';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<IProductPathService>(IProductPathService, DataScienceProductPathService);
    serviceManager.addSingleton<IWebviewPanelProvider>(IWebviewPanelProvider, WebviewPanelProvider);
    serviceManager.addSingleton<IWebviewViewProvider>(IWebviewViewProvider, WebviewViewProvider);
}
