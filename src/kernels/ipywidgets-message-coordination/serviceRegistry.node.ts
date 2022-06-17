import { IServiceManager } from '../../platform/ioc/types';
import { ScriptSourceProviderFactory } from './scriptSourceProviderFactory.node';
import { ScriptUriConverter } from './scriptUriConverter';
import {
    IIPyWidgetScriptManagerFactory,
    ILocalResourceUriConverter,
    INbExtensionsPathProvider,
    IWidgetScriptSourceProviderFactory
} from './types';
import { IPyWidgetMessageDispatcherFactory } from './ipyWidgetMessageDispatcherFactory';
import { NbExtensionsPathProvider } from './nbExtensionsPathProvider.node';
import { IPyWidgetScriptManagerFactory } from './ipyWidgetScriptManagerFactory.node';

export function registerTypes(serviceManager: IServiceManager, _isDevMode: boolean) {
    serviceManager.addSingleton<IPyWidgetMessageDispatcherFactory>(
        IPyWidgetMessageDispatcherFactory,
        IPyWidgetMessageDispatcherFactory
    );
    serviceManager.addSingleton(IWidgetScriptSourceProviderFactory, ScriptSourceProviderFactory);
    serviceManager.add(ILocalResourceUriConverter, ScriptUriConverter);
    serviceManager.addSingleton(IIPyWidgetScriptManagerFactory, IPyWidgetScriptManagerFactory);
    serviceManager.addSingleton(INbExtensionsPathProvider, NbExtensionsPathProvider);
}
