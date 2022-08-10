// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { IServiceManager } from '../../platform/ioc/types';
import { InstallationChannelManager } from './channelManager.node';
import { CondaInstaller } from './condaInstaller.node';
import { PipEnvInstaller } from './pipEnvInstaller.node';
import { PipInstaller } from './pipInstaller.node';
import { PoetryInstaller } from './poetryInstaller.node';
import { ProductInstaller } from './productInstaller.node';
import { DataScienceProductPathService } from './productPath.node';
import { ProductService } from './productService.node';
import {
    IInstallationChannelManager,
    IInstaller,
    IModuleInstaller,
    IProductPathService,
    IProductService,
    ProductType
} from './types';

export function registerInstallerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<IModuleInstaller>(IModuleInstaller, CondaInstaller);
    serviceManager.addSingleton<IModuleInstaller>(IModuleInstaller, PipInstaller);
    serviceManager.addSingleton<IModuleInstaller>(IModuleInstaller, PipEnvInstaller);
    serviceManager.addSingleton<IModuleInstaller>(IModuleInstaller, PoetryInstaller);
    serviceManager.addSingleton<IInstallationChannelManager>(IInstallationChannelManager, InstallationChannelManager);
    serviceManager.addSingleton<IProductService>(IProductService, ProductService);
    serviceManager.addSingleton<IInstaller>(IInstaller, ProductInstaller);
    serviceManager.addSingleton<IProductPathService>(
        IProductPathService,
        DataScienceProductPathService,
        ProductType.DataScience
    );
}
