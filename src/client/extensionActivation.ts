// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

/* eslint-disable  */
import { commands, env, ExtensionMode, extensions, OutputChannel, UIKind, window, workspace } from 'vscode';

import { registerTypes as activationRegisterTypes } from './activation/serviceRegistry';
import { IExtensionActivationManager } from './activation/types';
import { registerTypes as registerApiTypes } from './api/serviceRegistry';
import { IApplicationEnvironment, ICommandManager } from './common/application/types';
import { isTestExecution, STANDARD_OUTPUT_CHANNEL } from './common/constants';
import { registerTypes as installerRegisterTypes } from './common/installer/serviceRegistry';
import { registerTypes as platformRegisterTypes } from './common/platform/serviceRegistry';
import { IFileSystem } from './common/platform/types';
import { registerTypes as processRegisterTypes } from './common/process/serviceRegistry';
import { registerTypes as commonRegisterTypes } from './common/serviceRegistry';
import {
    IConfigurationService,
    IExperimentService,
    IExtensionContext,
    IFeatureDeprecationManager,
    IOutputChannel,
    IsCodeSpace,
    IsDevMode
} from './common/types';
import * as localize from './common/utils/localize';
import { noop } from './common/utils/misc';
import { registerTypes as variableRegisterTypes } from './common/variables/serviceRegistry';
import { JUPYTER_OUTPUT_CHANNEL, PythonExtension } from './datascience/constants';
import { addClearCacheCommand } from './datascience/devTools/clearCache';
import { getJupyterOutputChannel } from './datascience/devTools/jupyterOutputChannel';
import { registerTypes as dataScienceRegisterTypes } from './datascience/serviceRegistry';
import { IDataScience } from './datascience/types';
import { IServiceContainer, IServiceManager } from './ioc/types';
import { addOutputChannelLogging, setLoggingLevel } from './logging';
import { registerLoggerTypes } from './logging/serviceRegistry';
import { setExtensionInstallTelemetryProperties } from './telemetry/extensionInstallTelemetry';
import { registerTypes as commonRegisterTerminalTypes } from './terminals/serviceRegistry';

export async function activateComponents(
    context: IExtensionContext,
    serviceManager: IServiceManager,
    serviceContainer: IServiceContainer
) {
    // We will be pulling code over from activateLegacy().

    return activateLegacy(context, serviceManager, serviceContainer);
}

/////////////////////////////
// old activation code

// eslint-disable-next-line
// TODO: Gradually move simple initialization
// and DI registration currently in this function over
// to initializeComponents().  Likewise with complex
// init and activation: move them to activateComponents().
// See https://github.com/microsoft/vscode-python/issues/10454.

async function activateLegacy(
    context: IExtensionContext,
    serviceManager: IServiceManager,
    serviceContainer: IServiceContainer
) {
    // register "services"
    const isDevMode =
        !isTestExecution() &&
        (context.extensionMode === ExtensionMode.Development ||
            workspace.getConfiguration('jupyter').get<boolean>('development', false));
    serviceManager.addSingletonInstance<boolean>(IsDevMode, isDevMode);
    if (isDevMode) {
        void commands.executeCommand('setContext', 'jupyter.development', true);
    }
    addClearCacheCommand(context, isDevMode);
    const standardOutputChannel = window.createOutputChannel(localize.OutputChannelNames.jupyter());
    addOutputChannelLogging(standardOutputChannel);
    serviceManager.addSingletonInstance<OutputChannel>(IOutputChannel, standardOutputChannel, STANDARD_OUTPUT_CHANNEL);
    serviceManager.addSingletonInstance<OutputChannel>(
        IOutputChannel,
        getJupyterOutputChannel(isDevMode, standardOutputChannel),
        JUPYTER_OUTPUT_CHANNEL
    );
    serviceManager.addSingletonInstance<boolean>(IsCodeSpace, env.uiKind == UIKind.Web);

    // Log versions of extensions.
    standardOutputChannel.appendLine(`Jupyter Extension Version: ${context.extension.packageJSON['version']}.`);
    const pythonExtension = extensions.getExtension(PythonExtension);
    if (pythonExtension) {
        standardOutputChannel.appendLine(`Python Extension Verison: ${pythonExtension.packageJSON['version']}.`);
    } else {
        standardOutputChannel.appendLine('Python Extension not installed.');
    }

    // Initialize logging to file if necessary as early as possible
    registerLoggerTypes(serviceManager);

    // Core registrations (non-feature specific).
    registerApiTypes(serviceManager);
    commonRegisterTypes(serviceManager);
    platformRegisterTypes(serviceManager);
    processRegisterTypes(serviceManager);

    // We need to setup this property before any telemetry is sent
    const fs = serviceManager.get<IFileSystem>(IFileSystem);
    await setExtensionInstallTelemetryProperties(fs);

    // Load the two data science experiments that we need to register types
    // Await here to keep the register method sync
    const experimentService = serviceContainer.get<IExperimentService>(IExperimentService);
    // This must be done first, this guarantees all experiment information has loaded & all telemetry will contain experiment info.
    await experimentService.activate();
    experimentService.logExperiments();

    let useVSCodeNotebookAPI = true;

    const applicationEnv = serviceManager.get<IApplicationEnvironment>(IApplicationEnvironment);
    // Feature specific registrations.
    variableRegisterTypes(serviceManager);
    installerRegisterTypes(serviceManager);
    commonRegisterTerminalTypes(serviceManager);

    const configuration = serviceManager.get<IConfigurationService>(IConfigurationService);
    // We should start logging using the log level as soon as possible, so set it as soon as we can access the level.
    // `IConfigurationService` may depend any of the registered types, so doing it after all registrations are finished.
    // XXX Move this *after* abExperiments is activated?
    const settings = configuration.getSettings();
    setLoggingLevel(settings.logging.level);
    settings.onDidChange(() => {
        setLoggingLevel(settings.logging.level);
    });

    // Register datascience types after experiments have loaded.
    // To ensure we can register types based on experiments.
    dataScienceRegisterTypes(serviceManager, useVSCodeNotebookAPI);

    // Language feature registrations.
    activationRegisterTypes(serviceManager);

    // "initialize" "services"
    const cmdManager = serviceContainer.get<ICommandManager>(ICommandManager);
    cmdManager.executeCommand('setContext', 'jupyter.vscode.channel', applicationEnv.channel).then(noop, noop);

    // "activate" everything else

    const manager = serviceContainer.get<IExtensionActivationManager>(IExtensionActivationManager);
    context.subscriptions.push(manager);
    manager.activateSync();
    const activationPromise = manager.activate();

    // Activate data science features after base features.
    const dataScience = serviceManager.get<IDataScience>(IDataScience);
    const dsActivationPromise = dataScience.activate();

    const deprecationMgr = serviceContainer.get<IFeatureDeprecationManager>(IFeatureDeprecationManager);
    deprecationMgr.initialize();
    context.subscriptions.push(deprecationMgr);

    return { activationPromise: activationPromise.then(() => dsActivationPromise) };
}
