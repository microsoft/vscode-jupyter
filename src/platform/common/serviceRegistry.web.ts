import { IServiceManager } from '../ioc/types';
import { ExperimentService } from './experiments/service';
import { FeatureDeprecationManager } from './featureDeprecationManager';
import { PersistentStateFactory } from './persistentState';
import { IsWindows, IExperimentService, IFeatureDeprecationManager, IPersistentStateFactory } from './types';
import { registerTypes as registerPlatformTypes } from './platform/serviceRegistry.web';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingletonInstance<boolean>(IsWindows, false);
    serviceManager.addSingleton<IExperimentService>(IExperimentService, ExperimentService);
    serviceManager.addSingleton<IFeatureDeprecationManager>(IFeatureDeprecationManager, FeatureDeprecationManager);
    serviceManager.addSingleton<IPersistentStateFactory>(IPersistentStateFactory, PersistentStateFactory);
    registerPlatformTypes(serviceManager);
}
