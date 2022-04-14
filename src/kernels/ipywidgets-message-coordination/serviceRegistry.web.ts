import { IServiceManager } from '../../platform/ioc/types';
import { ScriptSourceProviderFactory } from './scriptSourceProviderFactory.web';
import { ScriptUriConverter } from './scriptUriConverter.web';
import { ILocalResourceUriConverter, IWidgetScriptSourceProviderFactory } from './types';
import { IPyWidgetMessageDispatcherFactory } from './ipyWidgetMessageDispatcherFactory';
import { NotebookIPyWidgetCoordinator } from './notebookIPyWidgetCoordinator';

export function registerTypes(serviceManager: IServiceManager, _isDevMode: boolean) {
    serviceManager.addSingleton<NotebookIPyWidgetCoordinator>(
        NotebookIPyWidgetCoordinator,
        NotebookIPyWidgetCoordinator
    );
    serviceManager.addSingleton<IPyWidgetMessageDispatcherFactory>(
        IPyWidgetMessageDispatcherFactory,
        IPyWidgetMessageDispatcherFactory
    );
    serviceManager.addSingleton(IWidgetScriptSourceProviderFactory, ScriptSourceProviderFactory);
    serviceManager.add(ILocalResourceUriConverter, ScriptUriConverter);
}
