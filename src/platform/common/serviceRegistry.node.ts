// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IExtensionSingleActivationService } from '../activation/types';
import { IDataFrameScriptGenerator, IExperimentService, IHttpClient, IVariableScriptGenerator } from '../common/types';
import { IServiceManager } from '../ioc/types';
import { ApplicationEnvironment } from './application/applicationEnvironment.node';
import { ClipboardService } from './application/clipboard';
import { ReloadVSCodeCommandHandler } from './application/commands/reloadCommand.node';
import { DebugService } from './application/debugService';
import { DocumentManager } from './application/documentManager';
import { EncryptedStorage } from './application/encryptedStorage';
import { Extensions } from './application/extensions.node';
import { LanguageService } from './application/languageService.node';
import { VSCodeNotebook } from './application/notebook';
import {
    IApplicationEnvironment,
    IClipboard,
    IDebugService,
    IDocumentManager,
    IEncryptedStorage,
    ILanguageService,
    ITerminalManager,
    IVSCodeNotebook
} from './application/types';
import { AsyncDisposableRegistry } from './asyncDisposableRegistry';
import { CryptoUtils } from './crypto';
import { CryptoUtilsNode } from './crypto.node';
import { ExperimentService } from './experiments/service';
import { FeatureDeprecationManager } from './featureDeprecationManager';
import { BrowserService } from './net/browser';
import { HttpClient } from './net/httpClient';
import { PersistentStateFactory } from './persistentState';
import { IS_WINDOWS } from './platform/constants.node';
import { ProcessLogger } from './process/logger.node';
import { IProcessLogger } from './process/types.node';
import {
    IAsyncDisposableRegistry,
    IBrowserService,
    ICryptoUtils,
    IExtensions,
    IFeatureDeprecationManager,
    IPersistentStateFactory,
    IsWindows
} from './types';
import { IMultiStepInputFactory, MultiStepInputFactory } from './utils/multiStepInput';
import { LanguageInitializer } from '../telemetry/languageInitializer';
import { registerTypes as registerPlatformTypes } from './platform/serviceRegistry.node';
import { registerTypes as processRegisterTypes } from './process/serviceRegistry.node';
import { registerTypes as variableRegisterTypes } from './variables/serviceRegistry.node';
import { RunInDedicatedExtensionHostCommandHandler } from './application/commands/runInDedicatedExtensionHost.node';
import { TerminalManager } from './application/terminalManager.node';
import { VariableScriptGenerator } from './variableScriptGenerator';
import { DataFrameScriptGenerator } from './dataFrameScriptGenerator';

// eslint-disable-next-line
export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingletonInstance<boolean>(IsWindows, IS_WINDOWS);

    serviceManager.addSingleton<IExtensions>(IExtensions, Extensions);
    serviceManager.addSingleton<IPersistentStateFactory>(IPersistentStateFactory, PersistentStateFactory);
    serviceManager.addSingleton<IVSCodeNotebook>(IVSCodeNotebook, VSCodeNotebook);
    serviceManager.addSingleton<IClipboard>(IClipboard, ClipboardService);
    serviceManager.addSingleton<IProcessLogger>(IProcessLogger, ProcessLogger);
    serviceManager.addSingleton<IDocumentManager>(IDocumentManager, DocumentManager);
    serviceManager.addSingleton<IDebugService>(IDebugService, DebugService);
    serviceManager.addSingleton<IApplicationEnvironment>(IApplicationEnvironment, ApplicationEnvironment);
    serviceManager.addSingleton<IEncryptedStorage>(IEncryptedStorage, EncryptedStorage);
    serviceManager.addSingleton<ILanguageService>(ILanguageService, LanguageService);
    serviceManager.addSingleton<IBrowserService>(IBrowserService, BrowserService);
    serviceManager.addSingleton<IHttpClient>(IHttpClient, HttpClient);
    serviceManager.addSingleton<CryptoUtils>(CryptoUtils, CryptoUtils);
    serviceManager.addSingleton<ICryptoUtils>(ICryptoUtils, CryptoUtilsNode);
    serviceManager.addSingleton<IExperimentService>(IExperimentService, ExperimentService);
    serviceManager.addSingleton<ITerminalManager>(ITerminalManager, TerminalManager);
    serviceManager.addSingleton<IDataFrameScriptGenerator>(IDataFrameScriptGenerator, DataFrameScriptGenerator);
    serviceManager.addSingleton<IVariableScriptGenerator>(IVariableScriptGenerator, VariableScriptGenerator);

    serviceManager.addSingleton<IFeatureDeprecationManager>(IFeatureDeprecationManager, FeatureDeprecationManager);

    serviceManager.addSingleton<IAsyncDisposableRegistry>(IAsyncDisposableRegistry, AsyncDisposableRegistry);
    serviceManager.addSingleton<IMultiStepInputFactory>(IMultiStepInputFactory, MultiStepInputFactory);
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        LanguageInitializer
    );
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        ReloadVSCodeCommandHandler
    );
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        RunInDedicatedExtensionHostCommandHandler
    );
    registerPlatformTypes(serviceManager);
    processRegisterTypes(serviceManager);
    variableRegisterTypes(serviceManager);
}
