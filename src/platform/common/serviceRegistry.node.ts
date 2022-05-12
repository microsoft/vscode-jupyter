// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { IExtensionSingleActivationService, IExtensionSyncActivationService } from '../activation/types';
import { IExperimentService, IFileDownloader, IHttpClient } from '../common/types';
import { AmlComputeContext } from './amlContext.node';
import { IServiceManager } from '../ioc/types';
import { ImportTracker } from '../../telemetry/importTracker.node';
import { IImportTracker } from '../../telemetry/types';
import { ActiveResourceService } from './application/activeResource.node';
import { ApplicationEnvironment } from './application/applicationEnvironment.node';
import { ClipboardService } from './application/clipboard';
import { ReloadVSCodeCommandHandler } from './application/commands/reloadCommand.node';
import { DebugService } from './application/debugService.node';
import { DocumentManager } from './application/documentManager';
import { EncryptedStorage } from './application/encryptedStorage';
import { Extensions } from './application/extensions.node';
import { LanguageService } from './application/languageService.node';
import { VSCodeNotebook } from './application/notebook';
import {
    IActiveResourceService,
    IApplicationEnvironment,
    IClipboard,
    IDebugService,
    IDocumentManager,
    IEncryptedStorage,
    ILanguageService,
    IVSCodeNotebook
} from './application/types';
import { AsyncDisposableRegistry } from './asyncDisposableRegistry';
import { CryptoUtils } from './crypto';
import { ExperimentService } from './experiments/service';
import { FeatureDeprecationManager } from './featureDeprecationManager';
import { BrowserService } from './net/browser';
import { FileDownloader } from './net/fileDownloader.node';
import { HttpClient } from './net/httpClient.node';
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
import { PortAttributesProviders } from './net/portAttributeProvider.node';
import { LanguageInitializer } from '../../telemetry/languageInitializer';
import { registerTypes as registerPlatformTypes } from './platform/serviceRegistry.node';
import { registerTypes as processRegisterTypes } from './process/serviceRegistry.node';
import { registerTypes as variableRegisterTypes } from './variables/serviceRegistry.node';
import { RunInDedicatedExtensionHostCommandHandler } from './application/commands/runInDedicatedExtensionHost.node';
import { ActiveEditorContextService } from './activeEditorContext';

// eslint-disable-next-line
export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingletonInstance<boolean>(IsWindows, IS_WINDOWS);

    serviceManager.addSingleton<IActiveResourceService>(IActiveResourceService, ActiveResourceService);
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
    serviceManager.addSingleton<IFileDownloader>(IFileDownloader, FileDownloader);
    serviceManager.addSingleton<ICryptoUtils>(ICryptoUtils, CryptoUtils);
    serviceManager.addSingleton<IExperimentService>(IExperimentService, ExperimentService);

    serviceManager.addSingleton<IFeatureDeprecationManager>(IFeatureDeprecationManager, FeatureDeprecationManager);

    serviceManager.addSingleton<IAsyncDisposableRegistry>(IAsyncDisposableRegistry, AsyncDisposableRegistry);
    serviceManager.addSingleton<IMultiStepInputFactory>(IMultiStepInputFactory, MultiStepInputFactory);
    serviceManager.addSingleton<IImportTracker>(IImportTracker, ImportTracker);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, ImportTracker);
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
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        AmlComputeContext
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        PortAttributesProviders
    );
    serviceManager.addSingleton<AmlComputeContext>(AmlComputeContext, AmlComputeContext);
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        ActiveEditorContextService
    );

    registerPlatformTypes(serviceManager);
    processRegisterTypes(serviceManager);
    variableRegisterTypes(serviceManager);
}
