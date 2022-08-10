// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IServiceManager } from '../../../platform/ioc/types';
import { ScriptSourceProviderFactory } from './scriptSourceProvider/scriptSourceProviderFactory.web';
import { IIPyWidgetScriptManagerFactory, INbExtensionsPathProvider, IWidgetScriptSourceProviderFactory } from './types';
import { IPyWidgetMessageDispatcherFactory } from './message/ipyWidgetMessageDispatcherFactory';
import { IPyWidgetScriptManagerFactory } from './scriptSourceProvider/ipyWidgetScriptManagerFactory.web';
import { NbExtensionsPathProvider } from './scriptSourceProvider/nbExtensionsPathProvider.web';

export function registerTypes(serviceManager: IServiceManager, _isDevMode: boolean) {
    serviceManager.addSingleton<IPyWidgetMessageDispatcherFactory>(
        IPyWidgetMessageDispatcherFactory,
        IPyWidgetMessageDispatcherFactory
    );
    serviceManager.addSingleton(IWidgetScriptSourceProviderFactory, ScriptSourceProviderFactory);
    serviceManager.addSingleton(IIPyWidgetScriptManagerFactory, IPyWidgetScriptManagerFactory);
    serviceManager.addSingleton(INbExtensionsPathProvider, NbExtensionsPathProvider);
}
