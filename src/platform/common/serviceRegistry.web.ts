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
    IBrowserService,
    IHttpClient,
    IVariableScriptGenerator,
    IDataFrameScriptGenerator
} from './types';
import { registerTypes as registerPlatformTypes } from './platform/serviceRegistry.web';
import { Extensions } from './application/extensions.web';
import { CryptoUtils } from './crypto';
import { EncryptedStorage } from './application/encryptedStorage';
import { IClipboard, IDebugService, IDocumentManager, IEncryptedStorage, IVSCodeNotebook } from './application/types';
import { DocumentManager } from './application/documentManager';
import { VSCodeNotebook } from './application/notebook';
import { ClipboardService } from './application/clipboard';
import { AsyncDisposableRegistry } from './asyncDisposableRegistry';
import { IMultiStepInputFactory, MultiStepInputFactory } from './utils/multiStepInput';
import { BrowserService } from './net/browser';
import { DebugService } from './application/debugService';
import { HttpClient } from './net/httpClient';
import { DataFrameScriptGenerator } from './dataFrameScriptGenerator';
import { VariableScriptGenerator } from './variableScriptGenerator';

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
    serviceManager.addSingleton<IVSCodeNotebook>(IVSCodeNotebook, VSCodeNotebook);
    serviceManager.addSingleton<IClipboard>(IClipboard, ClipboardService);
    serviceManager.addSingleton<IAsyncDisposableRegistry>(IAsyncDisposableRegistry, AsyncDisposableRegistry);
    serviceManager.addSingleton<IMultiStepInputFactory>(IMultiStepInputFactory, MultiStepInputFactory);
    serviceManager.addSingleton<IBrowserService>(IBrowserService, BrowserService);
    serviceManager.addSingleton<IHttpClient>(IHttpClient, HttpClient);
    serviceManager.addSingleton<IDataFrameScriptGenerator>(IDataFrameScriptGenerator, DataFrameScriptGenerator);
    serviceManager.addSingleton<IVariableScriptGenerator>(IVariableScriptGenerator, VariableScriptGenerator);

    registerPlatformTypes(serviceManager);
}
