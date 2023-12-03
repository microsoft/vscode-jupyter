// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IExtensionSyncActivationService } from '../activation/types';
import { IExperimentService } from '../common/types';
import { IServiceManager } from '../ioc/types';
import { ApplicationEnvironment } from './application/applicationEnvironment.node';
import { ReloadVSCodeCommandHandler } from './application/commands/reloadCommand.node';
import { DebugService } from './application/debugService';
import { EncryptedStorage } from './application/encryptedStorage';
import { Extensions } from './application/extensions.node';
import { IApplicationEnvironment, IDebugService, IEncryptedStorage } from './application/types';
import { AsyncDisposableRegistry } from './asyncDisposableRegistry';
import { CryptoUtils } from './crypto';
import { ExperimentService } from './experiments/service';
import { FeatureManager } from './featureManager';
import { PersistentStateFactory } from './persistentState';
import { IS_WINDOWS } from './platform/constants.node';
import {
    IAsyncDisposableRegistry,
    ICryptoUtils,
    IExtensions,
    IFeaturesManager,
    IPersistentStateFactory,
    IsWindows
} from './types';
import { IMultiStepInputFactory, MultiStepInputFactory } from './utils/multiStepInput';
import { LanguageInitializer } from '../telemetry/languageInitializer';
import { registerTypes as registerPlatformTypes } from './platform/serviceRegistry.node';
import { registerTypes as processRegisterTypes } from './process/serviceRegistry.node';
import { registerTypes as variableRegisterTypes } from './variables/serviceRegistry.node';
import { RunInDedicatedExtensionHostCommandHandler } from './application/commands/runInDedicatedExtensionHost.node';
import { OldCacheCleaner } from './cache';

// eslint-disable-next-line
export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingletonInstance<boolean>(IsWindows, IS_WINDOWS);

    serviceManager.addSingleton<IExtensions>(IExtensions, Extensions);
    serviceManager.addSingleton<IPersistentStateFactory>(IPersistentStateFactory, PersistentStateFactory);
    serviceManager.addSingleton<IDebugService>(IDebugService, DebugService);
    serviceManager.addSingleton<IApplicationEnvironment>(IApplicationEnvironment, ApplicationEnvironment);
    serviceManager.addSingleton<IEncryptedStorage>(IEncryptedStorage, EncryptedStorage);
    serviceManager.addSingleton<ICryptoUtils>(ICryptoUtils, CryptoUtils);
    serviceManager.addSingleton<IExperimentService>(IExperimentService, ExperimentService);

    serviceManager.addSingleton<IFeaturesManager>(IFeaturesManager, FeatureManager);

    serviceManager.addSingleton<IAsyncDisposableRegistry>(IAsyncDisposableRegistry, AsyncDisposableRegistry);
    serviceManager.addSingleton<IMultiStepInputFactory>(IMultiStepInputFactory, MultiStepInputFactory);
    serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, LanguageInitializer);
    serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, OldCacheCleaner);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        ReloadVSCodeCommandHandler
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        RunInDedicatedExtensionHostCommandHandler
    );
    registerPlatformTypes(serviceManager);
    processRegisterTypes(serviceManager);
    variableRegisterTypes(serviceManager);
}
