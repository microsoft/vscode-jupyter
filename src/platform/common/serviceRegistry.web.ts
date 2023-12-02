// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IServiceManager } from '../ioc/types';
import { ExperimentService } from './experiments/service';
import { FeatureManager } from './featureManager';
import { PersistentStateFactory } from './persistentState';
import {
    IsWindows,
    IExperimentService,
    IFeaturesManager,
    IPersistentStateFactory,
    IExtensions,
    ICryptoUtils,
    IAsyncDisposableRegistry,
    IVariableScriptGenerator,
    IDataFrameScriptGenerator
} from './types';
import { registerTypes as registerPlatformTypes } from './platform/serviceRegistry.web';
import { Extensions } from './application/extensions.web';
import { CryptoUtils } from './crypto';
import { EncryptedStorage } from './application/encryptedStorage';
import { IClipboard, IDebugService, IDocumentManager, IEncryptedStorage } from './application/types';
import { DocumentManager } from './application/documentManager';
import { ClipboardService } from './application/clipboard';
import { AsyncDisposableRegistry } from './asyncDisposableRegistry';
import { IMultiStepInputFactory, MultiStepInputFactory } from './utils/multiStepInput';
import { DebugService } from './application/debugService';
import { DataFrameScriptGenerator } from '../interpreter/dataFrameScriptGenerator';
import { VariableScriptGenerator } from '../interpreter/variableScriptGenerator';
import { IExtensionSyncActivationService } from '../activation/types';
import { OldCacheCleaner } from './cache';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingletonInstance<boolean>(IsWindows, false);
    serviceManager.addSingleton<IExperimentService>(IExperimentService, ExperimentService);
    serviceManager.addSingleton<IFeaturesManager>(IFeaturesManager, FeatureManager);
    serviceManager.addSingleton<IPersistentStateFactory>(IPersistentStateFactory, PersistentStateFactory);
    serviceManager.addSingleton<IExtensions>(IExtensions, Extensions);
    serviceManager.addSingleton<ICryptoUtils>(ICryptoUtils, CryptoUtils);
    serviceManager.addSingleton<IEncryptedStorage>(IEncryptedStorage, EncryptedStorage);
    serviceManager.addSingleton<IDocumentManager>(IDocumentManager, DocumentManager);
    serviceManager.addSingleton<IDebugService>(IDebugService, DebugService);
    serviceManager.addSingleton<IClipboard>(IClipboard, ClipboardService);
    serviceManager.addSingleton<IAsyncDisposableRegistry>(IAsyncDisposableRegistry, AsyncDisposableRegistry);
    serviceManager.addSingleton<IMultiStepInputFactory>(IMultiStepInputFactory, MultiStepInputFactory);
    serviceManager.addSingleton<IDataFrameScriptGenerator>(IDataFrameScriptGenerator, DataFrameScriptGenerator);
    serviceManager.addSingleton<IVariableScriptGenerator>(IVariableScriptGenerator, VariableScriptGenerator);
    serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, OldCacheCleaner);

    registerPlatformTypes(serviceManager);
}
