// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Container } from 'inversify/lib/container/container';
import { ServiceContainer } from './platform/ioc/container';
import { ServiceManager } from './platform/ioc/serviceManager';
import {
    type OutputChannel,
    extensions,
    workspace,
    window,
    version,
    env,
    type Memento,
    type Disposable,
    type ProgressOptions,
    ProgressLocation,
    commands
} from 'vscode';
import {
    STANDARD_OUTPUT_CHANNEL,
    JUPYTER_OUTPUT_CHANNEL,
    PylanceExtension,
    PythonExtension,
    Telemetry
} from './platform/common/constants';
import { getDisplayPath } from './platform/common/platform/fs-paths';
import {
    GLOBAL_MEMENTO,
    IDisposableRegistry,
    IExperimentService,
    IExtensionContext,
    IFeaturesManager,
    IMemento,
    IOutputChannel,
    WORKSPACE_MEMENTO
} from './platform/common/types';
import { Common } from './platform/common/utils/localize';
import { IServiceContainer, IServiceManager } from './platform/ioc/types';
import { initializeLoggers as init, logger } from './platform/logging';
import { getJupyterOutputChannel } from './standalone/devTools/jupyterOutputChannel';
import { isUsingPylance } from './standalone/intellisense/notebookPythonPathService';
import { noop } from './platform/common/utils/misc';
import { sendErrorTelemetry } from './platform/telemetry/startupTelemetry';
import { createDeferred } from './platform/common/utils/async';
import { StopWatch } from './platform/common/utils/stopWatch';
import { sendTelemetryEvent } from './telemetry';
import { IExtensionActivationManager } from './platform/activation/types';
import { getVSCodeChannel } from './platform/common/application/applicationEnvironment';

export function initializeLoggers(
    context: IExtensionContext,
    options: {
        addConsoleLogger: boolean;
        userNameRegEx?: RegExp;
        homePathRegEx?: RegExp;
        platform?: string;
        arch?: string;
        homePath?: string;
    }
) {
    const standardOutputChannel = init(options);
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
        standardOutputChannel.appendLine(
            `Pylance Extension Version${isUsingPylance() ? '' : ' (Not Used) '}: ${
                pylanceExtension.packageJSON['version']
            }.`
        );
    } else {
        standardOutputChannel.appendLine('Pylance Extension not installed.');
    }
    if (options?.platform) {
        standardOutputChannel.appendLine(`Platform: ${options.platform} (${options.arch}).`);
    }
    if (!workspace.workspaceFolders || workspace.workspaceFolders.length === 0) {
        standardOutputChannel.appendLine(`No workspace folder opened.`);
    } else if (workspace.workspaceFolders.length === 1) {
        standardOutputChannel.appendLine(
            `Workspace folder ${getDisplayPath(workspace.workspaceFolders[0].uri)}, Home = ${options?.homePath}`
        );
    } else {
        standardOutputChannel.appendLine(
            `Multiple Workspace folders opened ${workspace.workspaceFolders
                .map((item) => getDisplayPath(item.uri))
                .join(', ')}`
        );
    }

    return standardOutputChannel;
}

export function initializeGlobals(
    context: IExtensionContext,
    standardOutputChannel: OutputChannel
): [IServiceManager, IServiceContainer] {
    const cont = new Container({ skipBaseClassChecks: true });
    const serviceManager = new ServiceManager(cont);
    const serviceContainer = new ServiceContainer(cont);

    serviceManager.addSingletonInstance<IServiceContainer>(IServiceContainer, serviceContainer);
    serviceManager.addSingletonInstance<IServiceManager>(IServiceManager, serviceManager);

    serviceManager.addSingletonInstance<Disposable[]>(IDisposableRegistry, context.subscriptions);
    serviceManager.addSingletonInstance<Memento>(IMemento, context.globalState, GLOBAL_MEMENTO);
    serviceManager.addSingletonInstance<Memento>(IMemento, context.workspaceState, WORKSPACE_MEMENTO);
    serviceManager.addSingletonInstance<IExtensionContext>(IExtensionContext, context);
    serviceManager.addSingletonInstance<OutputChannel>(IOutputChannel, standardOutputChannel, STANDARD_OUTPUT_CHANNEL);
    serviceManager.addSingletonInstance<OutputChannel>(
        IOutputChannel,
        getJupyterOutputChannel(context.subscriptions),
        JUPYTER_OUTPUT_CHANNEL
    );

    return [serviceManager, serviceContainer];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function displayProgress() {
    const promise = createDeferred<void>();
    const progressOptions: ProgressOptions = { location: ProgressLocation.Window, title: Common.loadingExtension };
    window.withProgress(progressOptions, () => promise.promise).then(noop, noop);
    return { dispose: () => promise.resolve() };
}

export function handleError(
    ex: Error,
    startupDurations: {
        totalActivateTime: number;
        codeLoadingTime: number;
        startActivateTime: number;
        endActivateTime: number;
        workspaceFolderCount: number;
    },
    stopWatch: {
        elapsedTime: number;
    }
) {
    notifyUser(Common.handleExtensionActivationError);
    // Possible logger hasn't initialized either.
    console.error('extension activation failed', ex);
    logger.error('extension activation failed', ex);
    sendErrorTelemetry(ex, startupDurations, stopWatch);
}

function notifyUser(msg: string) {
    try {
        window.showErrorMessage(msg).then(noop, noop);
    } catch (ex) {
        logger.error('failed to notify user', ex);
    }
}

export async function postActivateLegacy(context: IExtensionContext, serviceContainer: IServiceContainer) {
    // Load the two data science experiments that we need to register types
    // Await here to keep the register method sync
    const experimentService = serviceContainer.get<IExperimentService>(IExperimentService);
    // This must be done first, this guarantees all experiment information has loaded & all telemetry will contain experiment info.
    const stopWatch = new StopWatch();
    await experimentService.activate();
    const duration = stopWatch.elapsedTime;
    sendTelemetryEvent(Telemetry.ExperimentLoad, { duration });

    // "initialize" "services"
    commands.executeCommand('setContext', 'jupyter.vscode.channel', getVSCodeChannel()).then(noop, noop);

    // "activate" everything else
    serviceContainer.get<IExtensionActivationManager>(IExtensionActivationManager).activate();
    const featureManager = serviceContainer.get<IFeaturesManager>(IFeaturesManager);
    featureManager.initialize();
    context.subscriptions.push(featureManager);
}
