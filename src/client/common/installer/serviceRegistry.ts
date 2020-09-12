// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { IServiceManager } from '../../ioc/types';
import { IWebviewPanelProvider } from '../application/types';
import { WebviewPanelProvider } from '../application/webviewPanels/webviewPanelProvider';
import { ProductType } from '../types';
import { InsidersBuildInstaller, StableBuildInstaller } from './extensionBuildInstaller';
import { DataScienceProductPathService } from './productPath';
import { ProductService } from './productService';
import {
    IExtensionBuildInstaller,
    INSIDERS_INSTALLER,
    IProductPathService,
    IProductService,
    STABLE_INSTALLER
} from './types';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<IExtensionBuildInstaller>(
        IExtensionBuildInstaller,
        StableBuildInstaller,
        STABLE_INSTALLER
    );
    serviceManager.addSingleton<IExtensionBuildInstaller>(
        IExtensionBuildInstaller,
        InsidersBuildInstaller,
        INSIDERS_INSTALLER
    );

    serviceManager.addSingleton<IProductService>(IProductService, ProductService);
    serviceManager.addSingleton<IProductPathService>(
        IProductPathService,
        DataScienceProductPathService,
        ProductType.DataScience
    );
    serviceManager.addSingleton<IWebviewPanelProvider>(IWebviewPanelProvider, WebviewPanelProvider);
}
