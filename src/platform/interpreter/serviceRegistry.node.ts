// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IExtensionSyncActivationService } from '../activation/types';
import { IDataFrameScriptGenerator, IVariableScriptGenerator } from '../common/types';
import { IServiceManager } from '../ioc/types';
import { CondaService } from './condaService.node';
import { DataFrameScriptGenerator } from './dataFrameScriptGenerator';
import { GlobalPythonSiteService } from './globalPythonSiteService.node';
import { InstallationChannelManager } from './installer/channelManager.node';
import { CondaInstaller } from './installer/condaInstaller.node';
import { PipEnvInstaller } from './installer/pipEnvInstaller.node';
import { PipInstaller } from './installer/pipInstaller.node';
import { PoetryInstaller } from './installer/poetryInstaller.node';
import { ProductInstaller } from './installer/productInstaller.node';
import { DataScienceProductPathService } from './installer/productPath.node';
import { ProductService } from './installer/productService.node';
import {
    IModuleInstaller,
    IInstallationChannelManager,
    IProductService,
    IInstaller,
    IProductPathService,
    ProductType
} from './installer/types';
import { InterpreterPackages } from './interpreterPackages.node';
import { PythonExecutionFactory } from './pythonExecutionFactory.node';
import { ReservedNamedProvider } from './reservedNamedProvider.node';
import { IInterpreterPackages, IReservedPythonNamedProvider } from './types';
import { IPythonExecutionFactory } from './types.node';
import { VariableScriptGenerator } from './variableScriptGenerator';
import { WorkspaceInterpreterTracker } from './workspaceInterpreterTracker';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<IPythonExecutionFactory>(IPythonExecutionFactory, PythonExecutionFactory);
    serviceManager.addSingleton<CondaService>(CondaService, CondaService);
    serviceManager.addSingleton<GlobalPythonSiteService>(GlobalPythonSiteService, GlobalPythonSiteService);
    serviceManager.addSingleton<IInterpreterPackages>(IInterpreterPackages, InterpreterPackages);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        WorkspaceInterpreterTracker
    );
    serviceManager.addSingleton<IReservedPythonNamedProvider>(IReservedPythonNamedProvider, ReservedNamedProvider);
    serviceManager.addSingleton<IVariableScriptGenerator>(IVariableScriptGenerator, VariableScriptGenerator);
    serviceManager.addSingleton<IDataFrameScriptGenerator>(IDataFrameScriptGenerator, DataFrameScriptGenerator);
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
