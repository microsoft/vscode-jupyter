// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

class StopWatch {
    private started = Date.now();
    public get elapsedTime() {
        return Date.now() - this.started;
    }
    public reset() {
        this.started = Date.now();
    }
}
// Do not move this line of code (used to measure extension load times).
const stopWatch = new StopWatch();

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

// reflect-metadata is needed by inversify, this must come before any inversify references
import './platform/ioc/reflectMetadata';

// Initialize the logger first.
import './platform/logging';

//===============================================
// loading starts here

import { commands, env, ExtensionMode, UIKind, workspace, type OutputChannel } from 'vscode';
import { buildApi, IExtensionApi } from './standalone/api';
import { logger, setHomeDirectory } from './platform/logging';
import { IAsyncDisposableRegistry, IExtensionContext, IsDevMode } from './platform/common/types';
import { IServiceContainer, IServiceManager } from './platform/ioc/types';
import { sendStartupTelemetry } from './platform/telemetry/startupTelemetry';
import { noop } from './platform/common/utils/misc';
import { registerTypes as registerPlatformTypes } from './platform/serviceRegistry.node';
import { registerTypes as registerKernelTypes } from './kernels/serviceRegistry.node';
import { registerTypes as registerNotebookTypes } from './notebooks/serviceRegistry.node';
import { registerTypes as registerInteractiveTypes } from './interactive-window/serviceRegistry.node';
import { registerTypes as registerStandaloneTypes } from './standalone/serviceRegistry.node';
import { registerTypes as registerWebviewTypes } from './webviews/extension-side/serviceRegistry.node';
import { Exiting, isTestExecution, setIsCodeSpace, setIsWebExtension } from './platform/common/constants';
import { initializeGlobals as initializeTelemetryGlobals } from './platform/telemetry/telemetry';
import { IInterpreterPackages } from './platform/interpreter/types';
import { homedir, platform, arch, userInfo } from 'os';
import { getUserHomeDir } from './platform/common/utils/platform.node';
import { homePath } from './platform/common/platform/fs-paths.node';
import {
    activate as activateExecutionAnalysis,
    deactivate as deactivateExecutionAnalysis
} from './standalone/executionAnalysis/extension';
import { activate as activateChat, deactivate as deactivateChat } from './standalone/chat/extesnion';
import { setDisposableTracker } from './platform/common/utils/lifecycle';
import {
    initializeLoggers,
    displayProgress,
    handleError,
    initializeGlobals,
    postActivateLegacy
} from './extension.common';
import { activateNotebookTelemetry } from './kernels/telemetry/notebookTelemetry';

durations.codeLoadingTime = stopWatch.elapsedTime;

//===============================================
// loading ends here

// These persist between activations:
let activatedServiceContainer: IServiceContainer | undefined;

/////////////////////////////
// public functions

export async function activate(context: IExtensionContext): Promise<IExtensionApi> {
    durations.startActivateTime = stopWatch.elapsedTime;
    const standardOutputChannel = initializeLoggers(context, {
        addConsoleLogger: !!process.env.VSC_JUPYTER_FORCE_LOGGING,
        userNameRegEx: tryGetUsername(),
        homePathRegEx: tryGetHomePath(),
        arch: arch(),
        platform: platform(),
        homePath: homePath.fsPath
    });

    activateNotebookTelemetry(stopWatch);
    setDisposableTracker(context.subscriptions);
    setIsCodeSpace(env.uiKind == UIKind.Web);
    setIsWebExtension(false);
    context.subscriptions.push({ dispose: () => (Exiting.isExiting = true) });
    try {
        const [api, ready] = activateUnsafe(context, standardOutputChannel);
        await ready;
        // Send the "success" telemetry only if activation did not fail.
        // Otherwise Telemetry is send via the error handler.
        durations.endActivateTime = stopWatch.elapsedTime;
        sendStartupTelemetry(durations, stopWatch);
        return api;
    } catch (ex) {
        // We want to completely handle the error
        // before notifying VS Code.
        durations.endActivateTime = stopWatch.elapsedTime;
        handleError(ex, durations, stopWatch);
        logger.error('Failed to active the Jupyter Extension', ex);
        // Disable this, as we don't want Python extension or any other extensions that depend on this to fall over.
        // Return a dummy object, to ensure other extension do not fall over.
        return {
            ready: Promise.resolve(),
            registerPythonApi: noop,
            registerRemoteServerProvider: () => ({ dispose: noop }),
            getKernelService: () => Promise.resolve(undefined),
            addRemoteJupyterServer: () => Promise.resolve(undefined),
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
    deactivateChat();

    return Promise.resolve();
}

/////////////////////////////
// activation helpers

// eslint-disable-next-line
function activateUnsafe(
    context: IExtensionContext,
    standardOutputChannel: OutputChannel
): [IExtensionApi, Promise<void>, IServiceContainer] {
    const progress = displayProgress();
    try {
        //===============================================
        // activation starts here

        const [serviceManager, serviceContainer] = initializeGlobals(context, standardOutputChannel);
        activatedServiceContainer = serviceContainer;
        initializeTelemetryGlobals((interpreter) =>
            serviceContainer.get<IInterpreterPackages>(IInterpreterPackages).getPackageVersions(interpreter)
        );
        const activationPromise = activateLegacy(context, serviceManager, serviceContainer);

        //===============================================
        // activation ends here

        //===============================================
        // dynamically load standalone plugins
        activateExecutionAnalysis(context).then(noop, noop);
        activateChat(context).then(noop, noop);

        const api = buildApi(activationPromise, serviceManager, serviceContainer, context);
        return [api, activationPromise, serviceContainer];
    } finally {
        progress.dispose();
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

    // Register the rest of the types (platform is first because it's needed by others)
    registerPlatformTypes(serviceManager);
    registerKernelTypes(serviceManager, isDevMode);
    registerNotebookTypes(serviceManager, isDevMode);
    registerInteractiveTypes(serviceManager);
    registerStandaloneTypes(context, serviceManager, isDevMode);
    registerWebviewTypes(serviceManager);

    await postActivateLegacy(context, serviceContainer);
}
