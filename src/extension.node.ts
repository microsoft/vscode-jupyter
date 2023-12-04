// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// reflect-metadata is needed by inversify, this must come before any inversify references
import './platform/ioc/reflectMetadata';

// Initialize the logger first.
import './platform/logging';

//===============================================
// We start tracking the extension's startup time at this point.  The
// locations at which we record various Intervals are marked below in
// the same way as this.

const durations = {
    totalActivateTime: 0,
    codeLoadingTime: 0,
    startActivateTime: 0,
    endActivateTime: 0,
    workspaceFolderCount: 0
};
import { StopWatch } from './platform/common/utils/stopWatch';
// Do not move this line of code (used to measure extension load times).
const stopWatch = new StopWatch();

//===============================================
// loading starts here

import {
    commands,
    Disposable,
    env,
    ExtensionMode,
    extensions,
    Memento,
    OutputChannel,
    ProgressLocation,
    ProgressOptions,
    UIKind,
    version,
    window,
    workspace
} from 'vscode';
import { buildApi, IExtensionApi } from './standalone/api/api';
import { setHomeDirectory, traceError } from './platform/logging';
import {
    GLOBAL_MEMENTO,
    IAsyncDisposableRegistry,
    IConfigurationService,
    IDisposableRegistry,
    IExperimentService,
    IExtensionContext,
    IFeaturesManager,
    IMemento,
    IOutputChannel,
    IsDevMode,
    WORKSPACE_MEMENTO
} from './platform/common/types';
import { createDeferred } from './platform/common/utils/async';
import { Common, OutputChannelNames } from './platform/common/utils/localize';
import { IServiceContainer, IServiceManager } from './platform/ioc/types';
import { sendErrorTelemetry, sendStartupTelemetry } from './platform/telemetry/startupTelemetry';
import { noop } from './platform/common/utils/misc';
import { registerTypes as registerPlatformTypes } from './platform/serviceRegistry.node';
import { registerTypes as registerKernelTypes } from './kernels/serviceRegistry.node';
import { registerTypes as registerNotebookTypes } from './notebooks/serviceRegistry.node';
import { registerTypes as registerInteractiveTypes } from './interactive-window/serviceRegistry.node';
import { registerTypes as registerStandaloneTypes } from './standalone/serviceRegistry.node';
import { registerTypes as registerWebviewTypes } from './webviews/extension-side/serviceRegistry.node';
import { IExtensionActivationManager } from './platform/activation/types';
import {
    Exiting,
    isCI,
    isTestExecution,
    JUPYTER_OUTPUT_CHANNEL,
    PylanceExtension,
    PythonExtension,
    setIsCodeSpace,
    setIsWebExtension,
    STANDARD_OUTPUT_CHANNEL,
    Telemetry
} from './platform/common/constants';
import { getDisplayPath } from './platform/common/platform/fs-paths';
import { getJupyterOutputChannel } from './standalone/devTools/jupyterOutputChannel';
import { registerLogger, setLoggingLevel } from './platform/logging';
import { Container } from 'inversify/lib/container/container';
import { ServiceContainer } from './platform/ioc/container';
import { ServiceManager } from './platform/ioc/serviceManager';
import { OutputChannelLogger } from './platform/logging/outputChannelLogger';
import { ConsoleLogger } from './platform/logging/consoleLogger';
import { initializeGlobals as initializeTelemetryGlobals } from './platform/telemetry/telemetry';
import { IInterpreterPackages } from './platform/interpreter/types';
import { homedir, platform, arch, userInfo } from 'os';
import { getUserHomeDir } from './platform/common/utils/platform.node';
import { homePath } from './platform/common/platform/fs-paths.node';
import {
    activate as activateExecutionAnalysis,
    deactivate as deactivateExecutionAnalysis
} from './standalone/executionAnalysis/extension';
import { setDisposableTracker } from './platform/common/utils/lifecycle';
import { sendTelemetryEvent } from './telemetry';
import { getVSCodeChannel } from './platform/common/application/applicationEnvironment';

durations.codeLoadingTime = stopWatch.elapsedTime;

//===============================================
// loading ends here

// These persist between activations:
let activatedServiceContainer: IServiceContainer | undefined;

/////////////////////////////
// public functions

export async function activate(context: IExtensionContext): Promise<IExtensionApi> {
    setDisposableTracker(context.subscriptions);
    setIsCodeSpace(env.uiKind == UIKind.Web);
    setIsWebExtension(false);
    context.subscriptions.push({ dispose: () => (Exiting.isExiting = true) });
    try {
        let api: IExtensionApi;
        let ready: Promise<void>;
        [api, ready] = await activateUnsafe(context, stopWatch, durations);
        // Send the "success" telemetry only if activation did not fail.
        // Otherwise Telemetry is send via the error handler.
        sendStartupTelemetry(ready, durations, stopWatch)
            // Run in the background.
            .catch(noop);
        await ready;
        return api;
    } catch (ex) {
        // We want to completely handle the error
        // before notifying VS Code.
        await handleError(ex, durations);
        traceError('Failed to active the Jupyter Extension', ex);
        // Disable this, as we don't want Python extension or any other extensions that depend on this to fall over.
        // Return a dummy object, to ensure other extension do not fall over.
        return {
            ready: Promise.resolve(),
            registerPythonApi: noop,
            getKernelService: () => Promise.resolve(undefined),
            openNotebook: () => Promise.reject(),
            createJupyterServerCollection: () => {
                throw new Error('Not Implemented');
            },
            kernels: { getKernel: () => Promise.resolve(undefined) }
        };
    }
}

export function deactivate(): Thenable<void> {
    Exiting.isExiting = true;
    // Make sure to shutdown anybody who needs it.
    if (activatedServiceContainer) {
        const registry = activatedServiceContainer.get<IAsyncDisposableRegistry>(IAsyncDisposableRegistry);
        if (registry) {
            return registry.dispose();
        }
    }

    deactivateExecutionAnalysis();

    return Promise.resolve();
}

/////////////////////////////
// activation helpers

// eslint-disable-next-line
async function activateUnsafe(
    context: IExtensionContext,
    startupStopWatch: StopWatch,
    startupDurations: {
        startActivateTime: number;
        endActivateTime: number;
    }
): Promise<[IExtensionApi, Promise<void>, IServiceContainer]> {
    const activationDeferred = createDeferred<void>();
    try {
        displayProgress(activationDeferred.promise);
        startupDurations.startActivateTime = startupStopWatch.elapsedTime;

        //===============================================
        // activation starts here

        const [serviceManager, serviceContainer] = initializeGlobals(context);
        activatedServiceContainer = serviceContainer;
        initializeTelemetryGlobals((interpreter) =>
            serviceContainer.get<IInterpreterPackages>(IInterpreterPackages).getPackageVersions(interpreter)
        );
        const activationPromise = activateComponents(context, serviceManager, serviceContainer);

        //===============================================
        // activation ends here

        startupDurations.endActivateTime = startupStopWatch.elapsedTime;
        activationDeferred.resolve();

        //===============================================
        // dynamically load standalone plugins
        activateExecutionAnalysis(context).then(noop, noop);

        const api = buildApi(activationPromise, serviceManager, serviceContainer, context);
        return [api, activationPromise, serviceContainer];
    } finally {
        // Make sure that we clear our status message
        if (!activationDeferred.completed) {
            activationDeferred.reject();
        }
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function displayProgress(promise: Promise<any>) {
    const progressOptions: ProgressOptions = { location: ProgressLocation.Window, title: Common.loadingExtension };
    window.withProgress(progressOptions, () => promise).then(noop, noop);
}

/////////////////////////////
// error handling

async function handleError(ex: Error, startupDurations: typeof durations) {
    notifyUser(Common.handleExtensionActivationError);
    // Possible logger hasn't initialized either.
    console.error('extension activation failed', ex);
    traceError('extension activation failed', ex);
    await sendErrorTelemetry(ex, startupDurations);
}

function notifyUser(msg: string) {
    try {
        window.showErrorMessage(msg).then(noop, noop);
    } catch (ex) {
        traceError('failed to notify user', ex);
    }
}

async function activateComponents(
    context: IExtensionContext,
    serviceManager: IServiceManager,
    serviceContainer: IServiceContainer
) {
    // We will be pulling code over from activateLegacy().
    return activateLegacy(context, serviceManager, serviceContainer);
}

function addConsoleLogger() {
    if (process.env.VSC_JUPYTER_FORCE_LOGGING) {
        let label = undefined;
        // In CI there's no need for the label.
        if (!isCI) {
            label = 'Jupyter Extension:';
        }

        registerLogger(new ConsoleLogger(label));
    }
}

function escapeRegExp(text: string) {
    return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

function tryGetUsername() {
    try {
        const username = escapeRegExp(userInfo().username);
        return new RegExp(username, 'ig');
    } catch (e) {
        console.info(
            `jupyter extension failed to get username info with ${e}\n username will not be obfuscated in local logs`
        );
    }
}

function tryGetHomePath() {
    try {
        const homeDir = escapeRegExp(getUserHomeDir().fsPath);
        return new RegExp(homeDir, 'ig');
    } catch (e) {
        console.info(
            `jupyter extension failed to get home directory path with ${e}\n home Path will not be obfuscated in local logs`
        );
    }
}

function addOutputChannel(context: IExtensionContext, serviceManager: IServiceManager) {
    const standardOutputChannel = window.createOutputChannel(OutputChannelNames.jupyter, 'log');
    registerLogger(new OutputChannelLogger(standardOutputChannel, tryGetHomePath(), tryGetUsername()));
    serviceManager.addSingletonInstance<OutputChannel>(IOutputChannel, standardOutputChannel, STANDARD_OUTPUT_CHANNEL);
    serviceManager.addSingletonInstance<OutputChannel>(
        IOutputChannel,
        getJupyterOutputChannel(context.subscriptions),
        JUPYTER_OUTPUT_CHANNEL
    );

    // Log env info.
    standardOutputChannel.appendLine(`${env.appName} (${version}, ${env.remoteName}, ${env.appHost})`);
    standardOutputChannel.appendLine(`Jupyter Extension Version: ${context.extension.packageJSON['version']}.`);
    const pythonExtension = extensions.getExtension(PythonExtension);
    if (pythonExtension) {
        standardOutputChannel.appendLine(`Python Extension Version: ${pythonExtension.packageJSON['version']}.`);
    } else {
        standardOutputChannel.appendLine('Python Extension not installed.');
    }
    const pylanceExtension = extensions.getExtension(PylanceExtension);
    if (pylanceExtension) {
        standardOutputChannel.appendLine(`Pylance Extension Version: ${pylanceExtension.packageJSON['version']}.`);
    } else {
        standardOutputChannel.appendLine('Pylance Extension not installed.');
    }
    standardOutputChannel.appendLine(`Platform: ${platform()} (${arch()}).`);
    if (!workspace.workspaceFolders || workspace.workspaceFolders.length === 0) {
        standardOutputChannel.appendLine(`No workspace folder opened.`);
    } else if (workspace.workspaceFolders.length === 1) {
        standardOutputChannel.appendLine(
            `Workspace folder ${getDisplayPath(workspace.workspaceFolders[0].uri)}, Home = ${homePath.fsPath}`
        );
    } else {
        standardOutputChannel.appendLine(
            `Multiple Workspace folders opened ${workspace.workspaceFolders
                .map((item) => getDisplayPath(item.uri))
                .join(', ')}`
        );
    }
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
        commands.executeCommand('setContext', 'jupyter.development', true).then(noop, noop);
    }
    commands.executeCommand('setContext', 'jupyter.webExtension', false).then(noop, noop);

    // Set the logger home dir (we can compute this in a node app)
    setHomeDirectory(homedir());

    // Setup the console logger if asked to
    addConsoleLogger();
    // Output channel is special. We need it before everything else
    addOutputChannel(context, serviceManager);

    // Register the rest of the types (platform is first because it's needed by others)
    registerPlatformTypes(serviceManager);
    registerKernelTypes(serviceManager, isDevMode);
    registerNotebookTypes(serviceManager, isDevMode);
    registerInteractiveTypes(serviceManager);
    registerStandaloneTypes(context, serviceManager, isDevMode);
    registerWebviewTypes(serviceManager);

    // Load the two data science experiments that we need to register types
    // Await here to keep the register method sync
    const experimentService = serviceContainer.get<IExperimentService>(IExperimentService);
    // This must be done first, this guarantees all experiment information has loaded & all telemetry will contain experiment info.
    const stopWatch = new StopWatch();
    await experimentService.activate();
    const duration = stopWatch.elapsedTime;
    sendTelemetryEvent(Telemetry.ExperimentLoad, { duration });
    const configuration = serviceManager.get<IConfigurationService>(IConfigurationService);

    // We should start logging using the log level as soon as possible, so set it as soon as we can access the level.
    // `IConfigurationService` may depend any of the registered types, so doing it after all registrations are finished.
    // XXX Move this *after* abExperiments is activated?
    const settings = configuration.getSettings();
    setLoggingLevel(settings.logging.level);
    settings.onDidChange(() => {
        setLoggingLevel(settings.logging.level);
    });

    // "initialize" "services"
    commands.executeCommand('setContext', 'jupyter.vscode.channel', getVSCodeChannel()).then(noop, noop);

    // "activate" everything else
    serviceContainer.get<IExtensionActivationManager>(IExtensionActivationManager).activate();

    const featureManager = serviceContainer.get<IFeaturesManager>(IFeaturesManager);
    featureManager.initialize();
    context.subscriptions.push(featureManager);
}

function initializeGlobals(context: IExtensionContext): [IServiceManager, IServiceContainer] {
    const cont = new Container({ skipBaseClassChecks: true });
    const serviceManager = new ServiceManager(cont);
    const serviceContainer = new ServiceContainer(cont);

    serviceManager.addSingletonInstance<IServiceContainer>(IServiceContainer, serviceContainer);
    serviceManager.addSingletonInstance<IServiceManager>(IServiceManager, serviceManager);

    serviceManager.addSingletonInstance<Disposable[]>(IDisposableRegistry, context.subscriptions);
    serviceManager.addSingletonInstance<Memento>(IMemento, context.globalState, GLOBAL_MEMENTO);
    serviceManager.addSingletonInstance<Memento>(IMemento, context.workspaceState, WORKSPACE_MEMENTO);
    serviceManager.addSingletonInstance<IExtensionContext>(IExtensionContext, context);

    return [serviceManager, serviceContainer];
}
