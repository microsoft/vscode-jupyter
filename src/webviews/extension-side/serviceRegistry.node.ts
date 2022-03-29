// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { IExtensionSingleActivationService } from '../../platform/activation/types';
import { IWebviewViewProvider, IWebviewPanelProvider } from '../../platform/common/application/types';
import { IServiceManager } from '../../platform/ioc/types';
import { IVariableViewProvider } from './variablesView/types';
import { VariableViewActivationService } from './variablesView/variableViewActivationService';
import { VariableViewProvider } from './variablesView/variableViewProvider';
import { WebviewPanelProvider } from './webviewPanels/webviewPanelProvider';
import { WebviewViewProvider } from './webviewViews/webviewViewProvider';

export function registerTypes(serviceManager: IServiceManager, _isDevMode: boolean) {
    serviceManager.add<IWebviewViewProvider>(IWebviewViewProvider, WebviewViewProvider);
    serviceManager.add<IWebviewPanelProvider>(IWebviewPanelProvider, WebviewPanelProvider);
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        VariableViewActivationService
    );
    serviceManager.addSingleton<IVariableViewProvider>(IVariableViewProvider, VariableViewProvider);
}
