// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IServiceManager } from '../../../platform/ioc/types';
import { ScriptSourceProviderFactory } from './scriptSourceProvider/scriptSourceProviderFactory.node';
import { IIPyWidgetScriptManagerFactory, INbExtensionsPathProvider, IWidgetScriptSourceProviderFactory } from './types';
import { IPyWidgetMessageDispatcherFactory } from './message/ipyWidgetMessageDispatcherFactory';
import { NbExtensionsPathProvider } from './scriptSourceProvider/nbExtensionsPathProvider.node';
import { IPyWidgetScriptManagerFactory } from './scriptSourceProvider/ipyWidgetScriptManagerFactory.node';

export function registerTypes(serviceManager: IServiceManager, _isDevMode: boolean) {
    serviceManager.addSingleton<IPyWidgetMessageDispatcherFactory>(
        IPyWidgetMessageDispatcherFactory,
        IPyWidgetMessageDispatcherFactory
    );
    serviceManager.addSingleton(IWidgetScriptSourceProviderFactory, ScriptSourceProviderFactory);
    serviceManager.addSingleton(IIPyWidgetScriptManagerFactory, IPyWidgetScriptManagerFactory);
    serviceManager.addSingleton(INbExtensionsPathProvider, NbExtensionsPathProvider);
}
