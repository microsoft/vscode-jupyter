'use strict';

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */

// This line should always be right on top.
/* eslint-disable @typescript-eslint/no-explicit-any */
if ((Reflect as any).metadata === undefined) {
    require('reflect-metadata');
}

// Initialize the logger first.
require('./common/logger');

//===============================================
// We start tracking the extension's startup time at this point.  The
// locations at which we record various Intervals are marked below in
// the same way as this.

const durations: Record<string, number> = {};
import { StopWatch } from './common/utils/stopWatch';
// Do not move this line of code (used to measure extension load times).
const stopWatch = new StopWatch();

//===============================================
// loading starts here

import { ProgressLocation, ProgressOptions, window } from 'vscode';

import { buildApi, IExtensionApi } from './api';
import { IApplicationShell } from './common/application/types';
import { traceError } from './common/logger';
import { IAsyncDisposableRegistry, IExtensionContext } from './common/types';
import { createDeferred } from './common/utils/async';
import { Common } from './common/utils/localize';
import { activateComponents } from './extensionActivation';
import { initializeGlobals } from './extensionInit';
import { IServiceContainer } from './ioc/types';
import { sendErrorTelemetry, sendStartupTelemetry } from './startupTelemetry';
import { noop } from './common/utils/misc';

durations.codeLoadingTime = stopWatch.elapsedTime;

//===============================================
// loading ends here

// These persist between activations:
let activatedServiceContainer: IServiceContainer | undefined;

/////////////////////////////
// public functions

export async function activate(context: IExtensionContext): Promise<IExtensionApi> {
    try {
        let api: IExtensionApi;
        let ready: Promise<void>;
        let serviceContainer: IServiceContainer;
        [api, ready, serviceContainer] = await activateUnsafe(context, stopWatch, durations);
        // Send the "success" telemetry only if activation did not fail.
        // Otherwise Telemetry is send via the error handler.
        sendStartupTelemetry(ready, durations, stopWatch, serviceContainer)
            // Run in the background.
            .ignoreErrors();
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
            createBlankNotebook: () => Promise.resolve(),
            onKernelStateChange: () => ({ dispose: noop }),
            ready: Promise.resolve(),
            registerCellToolbarButton: () => ({ dispose: noop }),
            registerNewNotebookContent: () => Promise.resolve(),
            registerPythonApi: noop,
            registerRemoteServerProvider: noop,
            showDataViewer: () => Promise.resolve()
        };
    }
}

export function deactivate(): Thenable<void> {
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
async function activateUnsafe(
    context: IExtensionContext,
    startupStopWatch: StopWatch,
    startupDurations: Record<string, number>
): Promise<[IExtensionApi, Promise<void>, IServiceContainer]> {
    const activationDeferred = createDeferred<void>();
    try {
        displayProgress(activationDeferred.promise);
        startupDurations.startActivateTime = startupStopWatch.elapsedTime;

        //===============================================
        // activation starts here

        const [serviceManager, serviceContainer] = initializeGlobals(context);
        activatedServiceContainer = serviceContainer;
        const { activationPromise } = await activateComponents(context, serviceManager, serviceContainer);

        //===============================================
        // activation ends here

        startupDurations.endActivateTime = startupStopWatch.elapsedTime;
        activationDeferred.resolve();

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
    const progressOptions: ProgressOptions = { location: ProgressLocation.Window, title: Common.loadingExtension() };
    window.withProgress(progressOptions, () => promise).then(noop, noop);
}

/////////////////////////////
// error handling

async function handleError(ex: Error, startupDurations: Record<string, number>) {
    notifyUser(
        "Extension activation failed, run the 'Developer: Toggle Developer Tools' command for more information."
    );
    // Possible logger hasn't initialized either.
    console.error('extension activation failed', ex);
    traceError('extension activation failed', ex);
    await sendErrorTelemetry(ex, startupDurations, activatedServiceContainer);
}

interface IAppShell {
    showErrorMessage(string: string): Promise<void>;
}

function notifyUser(msg: string) {
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let appShell: IAppShell = (window as any) as IAppShell;
        if (activatedServiceContainer) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            appShell = (activatedServiceContainer.get<IApplicationShell>(IApplicationShell) as any) as IAppShell;
        }
        appShell.showErrorMessage(msg).ignoreErrors();
    } catch (ex) {
        traceError('failed to notify user', ex);
    }
}
