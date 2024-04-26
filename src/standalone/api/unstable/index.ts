// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri, commands, window, workspace } from 'vscode';
import { CodespacesJupyterServerSelector } from '../../../codespaces/codeSpacesServerSelector';
import { CodespaceExtensionId, JVSC_EXTENSION_ID, Telemetry } from '../../../platform/common/constants';
import { IDisposable, IExtensions } from '../../../platform/common/types';
import { IServiceContainer } from '../../../platform/ioc/types';
import { traceError } from '../../../platform/logging';
import {
    IControllerRegistration,
    ILocalPythonNotebookKernelSourceSelector
} from '../../../notebooks/controllers/types';
import { sendTelemetryEvent } from '../../../telemetry';
import { isRemoteConnection } from '../../../kernels/types';
import { IJupyterUriProvider } from '../../../api';
import { jupyterServerUriToCollection } from '../../../codespaces';
import { isWeb, noop } from '../../../platform/common/utils/misc';
import { EnvironmentPath } from '@vscode/python-extension';
import { createJupyterServerCollection } from '../servers';
import { IExportedKernelServiceFactory } from './types';

function waitForNotebookControllersCreationForServer(
    serverId: { id: string; handle: string },
    controllerRegistration: IControllerRegistration
) {
    return new Promise<void>((resolve) => {
        controllerRegistration.onDidChange((e) => {
            for (let controller of e.added) {
                if (
                    isRemoteConnection(controller.connection) &&
                    controller.connection.serverProviderHandle.id === serverId.id &&
                    controller.connection.serverProviderHandle.handle === serverId.handle
                ) {
                    resolve();
                }
            }
        });
    });
}

export function registerRemoteServerProvider(
    provider: IJupyterUriProvider,
    serviceContainer: IServiceContainer
): IDisposable {
    const extensions = serviceContainer.get<IExtensions>(IExtensions);
    const extensionId = provider.id.startsWith('_builtin')
        ? JVSC_EXTENSION_ID
        : extensions.determineExtensionFromCallStack().extensionId;
    traceError(
        `The API registerRemoteServerProvider has being deprecated and will be removed soon, please use createJupyterServerCollection (extension ${extensionId}).`
    );
    if (extensionId.toLowerCase() != CodespaceExtensionId.toLowerCase()) {
        throw new Error('Deprecated API');
    }
    sendTelemetryEvent(Telemetry.JupyterApiUsage, undefined, {
        clientExtId: extensionId,
        pemUsed: 'registerRemoteServerProvider'
    });
    const { serverProvider, commandProvider } = jupyterServerUriToCollection(provider);
    const collection = createJupyterServerCollection(
        provider.id,
        provider.displayName || provider.detail || provider.id,
        serverProvider,
        extensionId,
        serviceContainer
    );
    if (commandProvider) {
        collection.commandProvider = commandProvider;
    }
    return {
        dispose: () => {
            collection.dispose();
        }
    };
}
export function getReady(ready: Promise<unknown>): Promise<void> {
    return ready
        .then(() => noop())
        .catch((ex) => {
            traceError('Failure during activation.', ex);
            return Promise.reject(ex);
        });
}
export function getKernelService(serviceContainer: IServiceContainer) {
    const extensions = serviceContainer.get<IExtensions>(IExtensions);
    sendTelemetryEvent(Telemetry.JupyterApiUsage, undefined, {
        clientExtId: extensions.determineExtensionFromCallStack().extensionId,
        pemUsed: 'registerRemoteServerProvider'
    });
    const kernelServiceFactory = serviceContainer.get<IExportedKernelServiceFactory>(IExportedKernelServiceFactory);
    return kernelServiceFactory.getService();
}
export async function addRemoteJupyterServer(providerId: string, handle: string, serviceContainer: IServiceContainer) {
    const extensions = serviceContainer.get<IExtensions>(IExtensions);
    traceError(
        'The API addRemoteJupyterServer has being deprecated and will be removed soon, please use createJupyterServerCollection.'
    );
    const extensionId = extensions.determineExtensionFromCallStack().extensionId;
    if (extensionId.toLowerCase() != CodespaceExtensionId.toLowerCase()) {
        throw new Error('Deprecated API');
    }
    sendTelemetryEvent(Telemetry.JupyterApiUsage, undefined, {
        clientExtId: extensionId,
        pemUsed: 'addRemoteJupyterServer'
    });

    const selector = serviceContainer.get<CodespacesJupyterServerSelector>(CodespacesJupyterServerSelector);

    const controllerRegistration = serviceContainer.get<IControllerRegistration>(IControllerRegistration);
    const controllerCreatedPromise = waitForNotebookControllersCreationForServer(
        { id: providerId, handle },
        controllerRegistration
    );
    await selector.addJupyterServer({ id: providerId, handle, extensionId });
    await controllerCreatedPromise;
}

export async function openNotebook(
    uri: Uri,
    kernelOrPythonEnvId: string | EnvironmentPath,
    serviceContainer: IServiceContainer
) {
    const extensions = serviceContainer.get<IExtensions>(IExtensions);
    sendTelemetryEvent(Telemetry.JupyterApiUsage, undefined, {
        clientExtId: extensions.determineExtensionFromCallStack().extensionId,
        pemUsed: 'openNotebook'
    });
    const controllers = serviceContainer.get<IControllerRegistration>(IControllerRegistration);
    const kernelId = typeof kernelOrPythonEnvId === 'string' ? kernelOrPythonEnvId : undefined;
    const pythonEnv = typeof kernelOrPythonEnvId === 'string' ? undefined : kernelOrPythonEnvId;
    let id = kernelId && controllers.all.find((controller) => controller.id === kernelOrPythonEnvId)?.id;
    if (!id && pythonEnv && !isWeb()) {
        // Look for a python environment with this id.
        id = controllers.all.find(
            (controller) =>
                controller.kind === 'startUsingPythonInterpreter' && controller.interpreter.id === pythonEnv.id
        )?.id;
        if (!id) {
            // Controller has not yet been created.
            const selector = serviceContainer.get<ILocalPythonNotebookKernelSourceSelector>(
                ILocalPythonNotebookKernelSourceSelector
            );
            const connection = await selector.getKernelConnection(pythonEnv);
            id = connection && controllers.all.find((controller) => controller.id === connection?.id)?.id;
        }
    }
    if (!id) {
        throw new Error(`Kernel ${kernelOrPythonEnvId} not found.`);
    }
    const notebookEditor =
        window.activeNotebookEditor?.notebook?.uri?.toString() === uri.toString()
            ? window.activeNotebookEditor
            : await window.showNotebookDocument(await workspace.openNotebookDocument(uri));
    await commands.executeCommand('notebook.selectKernel', {
        notebookEditor,
        id,
        extension: JVSC_EXTENSION_ID
    });
    return notebookEditor.notebook;
}
