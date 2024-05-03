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

// Naive polyfill for setImmediate as it is required by @jupyterlab/services/lib/kernel/future.js
// when running in a web worker as it selects either requestAnimationFrame or setImmediate, both of
// which are not available in a worker in Safari.
declare var self: {};
if (typeof requestAnimationFrame === 'undefined' && typeof setImmediate === 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (self as any).setImmediate = (cb: (...args: any[]) => any) => setTimeout(cb);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (self as any).clearImmediate = (id: any) => clearTimeout(id);
}

// Initialize the logger first.
import './platform/logging';

//===============================================
// loading starts here

import { commands, env, ExtensionMode, UIKind, workspace, type OutputChannel } from 'vscode';
import { buildApi, IExtensionApi } from './standalone/api';
import { logger } from './platform/logging';
import { IAsyncDisposableRegistry, IExtensionContext, IsDevMode } from './platform/common/types';
import { IServiceContainer, IServiceManager } from './platform/ioc/types';
import { sendStartupTelemetry } from './platform/telemetry/startupTelemetry';
import { noop } from './platform/common/utils/misc';
import { registerTypes as registerPlatformTypes } from './platform/serviceRegistry.web';
import { registerTypes as registerKernelTypes } from './kernels/serviceRegistry.web';
import { registerTypes as registerNotebookTypes } from './notebooks/serviceRegistry.web';
import { registerTypes as registerInteractiveTypes } from './interactive-window/serviceRegistry.web';
import { registerTypes as registerTerminalTypes } from './platform/terminals/serviceRegistry.web';
import { registerTypes as registerStandaloneTypes } from './standalone/serviceRegistry.web';
import { registerTypes as registerWebviewTypes } from './webviews/extension-side/serviceRegistry.web';
import { Exiting, isTestExecution, setIsCodeSpace, setIsWebExtension } from './platform/common/constants';
import { initializeGlobals as initializeTelemetryGlobals } from './platform/telemetry/telemetry';
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
    const standardOutputChannel = initializeLoggers(context, { addConsoleLogger: isTestExecution() });

    activateNotebookTelemetry(stopWatch);
    setDisposableTracker(context.subscriptions);
    setIsCodeSpace(env.uiKind == UIKind.Web);
    setIsWebExtension(true);
    context.subscriptions.push({ dispose: () => (Exiting.isExiting = true) });
    try {
        const [api, ready] = activateUnsafe(context, standardOutputChannel);
        await ready;
        // Send the "success" telemetry only if activation did not fail.
        // Otherwise Telemetry is send via the error handler.
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
        initializeTelemetryGlobals(() => Promise.resolve(new Map()));
        const activationPromise = activateLegacy(context, serviceManager, serviceContainer);

        //===============================================
        // activation ends here

        const api = buildApi(activationPromise, serviceManager, serviceContainer, context);
        return [api, activationPromise, serviceContainer];
    } finally {
        progress.dispose();
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
        context.extensionMode === ExtensionMode.Development ||
        workspace.getConfiguration('jupyter').get<boolean>('development', false);

    serviceManager.addSingletonInstance<boolean>(IsDevMode, isDevMode);
    if (isDevMode) {
        commands.executeCommand('setContext', 'jupyter.development', true).then(noop, noop);
    }
    commands.executeCommand('setContext', 'jupyter.webExtension', true).then(noop, noop);

    // Register the rest of the types (platform is first because it's needed by others)
    registerPlatformTypes(serviceManager);
    registerNotebookTypes(serviceManager, isDevMode);
    registerKernelTypes(serviceManager, isDevMode);
    registerInteractiveTypes(serviceManager);
    registerTerminalTypes(serviceManager);
    registerStandaloneTypes(context, serviceManager, isDevMode);
    registerWebviewTypes(serviceManager);

    await postActivateLegacy(context, serviceContainer);
}
