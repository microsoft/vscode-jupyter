// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ExtensionMode, Uri, commands, window, workspace } from 'vscode';
import { JupyterServerSelector } from '../../kernels/jupyter/connection/serverSelector';
import { IJupyterServerProviderRegistry } from '../../kernels/jupyter/types';
import { IPythonApiProvider, PythonApi } from '../../platform/api/types';
import { isTestExecution, JVSC_EXTENSION_ID, Telemetry } from '../../platform/common/constants';
import { IDisposable, IExtensionContext, IExtensions } from '../../platform/common/types';
import { IServiceContainer, IServiceManager } from '../../platform/ioc/types';
import { traceError } from '../../platform/logging';
import { IControllerRegistration } from '../../notebooks/controllers/types';
import { sendTelemetryEvent } from '../../telemetry';
import { isRemoteConnection } from '../../kernels/types';
import {
    Jupyter,
    IExportedKernelService,
    IJupyterUriProvider,
    JupyterServerCollection,
    JupyterServerCommandProvider,
    JupyterServerProvider
} from '../../api';
import { stripCodicons } from '../../platform/common/helpers';
import { jupyterServerUriToCollection } from '../../kernels/jupyter/connection/jupyterServerProviderRegistry';
import { getKernelsApi } from '../../kernels/api/api';

export const IExportedKernelServiceFactory = Symbol('IExportedKernelServiceFactory');
export interface IExportedKernelServiceFactory {
    getService(): Promise<IExportedKernelService | undefined>;
}

/*
 * Do not introduce any breaking changes to this API.
 * This is the public API for other extensions to interact with this extension.
 */

export interface IExtensionApi extends Jupyter {}

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

export function buildApi(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ready: Promise<any>,
    serviceManager: IServiceManager,
    serviceContainer: IServiceContainer,
    context: IExtensionContext
): IExtensionApi {
    let registered = false;
    const extensions = serviceContainer.get<IExtensions>(IExtensions);
    const createJupyterServerCollection = (
        id: string,
        label: string,
        serverProvider: JupyterServerProvider,
        extensionId: string
    ) => {
        sendTelemetryEvent(Telemetry.JupyterApiUsage, undefined, {
            clientExtId: extensionId,
            pemUsed: 'createJupyterServerCollection'
        });
        const registration = serviceContainer.get<IJupyterServerProviderRegistry>(IJupyterServerProviderRegistry);
        const collection = registration.createJupyterServerCollection(
            extensionId,
            id,
            stripCodicons(label),
            serverProvider
        );

        // Omit PEMS that are only used for internal usage.
        // I.e. remove the unwanted PEMS and return the valid API to the extension.
        const proxy: Omit<JupyterServerCollection, 'onDidChangeProvider' | 'serverProvider' | 'extensionId'> = {
            dispose: () => {
                collection?.dispose();
            },
            get id() {
                return id;
            },
            set label(value: string) {
                collection.label = stripCodicons(value);
            },
            get label() {
                return collection.label;
            },
            set documentation(value: Uri | undefined) {
                collection.documentation = value;
            },
            get documentation() {
                return collection.documentation;
            },
            set commandProvider(value: JupyterServerCommandProvider | undefined) {
                collection.commandProvider = value;
            },
            get commandProvider() {
                return collection.commandProvider;
            }
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return proxy as any;
    };
    const api: IExtensionApi = {
        // 'ready' will propagate the exception, but we must log it here first.
        ready: ready.catch((ex) => {
            traceError('Failure during activation.', ex);
            return Promise.reject(ex);
        }),
        registerPythonApi: (pythonApi: PythonApi) => {
            if (registered) {
                return;
            }
            registered = true;
            const apiProvider = serviceContainer.get<IPythonApiProvider>(IPythonApiProvider);
            apiProvider.setApi(pythonApi);
        },
        registerRemoteServerProvider(provider: IJupyterUriProvider): IDisposable {
            traceError(
                'The API registerRemoteServerProvider has being deprecated and will be removed soon, please use createJupyterServerCollection.'
            );

            const extensions = serviceContainer.get<IExtensions>(IExtensions);
            const extensionId = provider.id.startsWith('_builtin')
                ? JVSC_EXTENSION_ID
                : extensions.determineExtensionFromCallStack().extensionId;
            sendTelemetryEvent(Telemetry.JupyterApiUsage, undefined, {
                clientExtId: extensionId,
                pemUsed: 'registerRemoteServerProvider'
            });
            const { serverProvider, commandProvider } = jupyterServerUriToCollection(provider);
            const collection = createJupyterServerCollection(
                provider.id,
                provider.displayName || provider.detail || provider.id,
                serverProvider,
                extensionId
            );
            if (commandProvider) {
                collection.commandProvider = commandProvider;
            }
            return {
                dispose: () => {
                    collection.dispose();
                }
            };
        },
        getKernelService: async () => {
            sendTelemetryEvent(Telemetry.JupyterApiUsage, undefined, {
                clientExtId: extensions.determineExtensionFromCallStack().extensionId,
                pemUsed: 'registerRemoteServerProvider'
            });
            const kernelServiceFactory =
                serviceContainer.get<IExportedKernelServiceFactory>(IExportedKernelServiceFactory);
            return kernelServiceFactory.getService();
        },
        addRemoteJupyterServer: async (providerId: string, handle: string) => {
            traceError(
                'The API addRemoteJupyterServer has being deprecated and will be removed soon, please use createJupyterServerCollection.'
            );
            const extensionId = extensions.determineExtensionFromCallStack().extensionId;
            sendTelemetryEvent(Telemetry.JupyterApiUsage, undefined, {
                clientExtId: extensionId,
                pemUsed: 'addRemoteJupyterServer'
            });

            const selector = serviceContainer.get<JupyterServerSelector>(JupyterServerSelector);

            const controllerRegistration = serviceContainer.get<IControllerRegistration>(IControllerRegistration);
            const controllerCreatedPromise = waitForNotebookControllersCreationForServer(
                { id: providerId, handle },
                controllerRegistration
            );
            await selector.addJupyterServer({ id: providerId, handle, extensionId });
            await controllerCreatedPromise;
        },
        openNotebook: async (uri: Uri, kernelId: string) => {
            sendTelemetryEvent(Telemetry.JupyterApiUsage, undefined, {
                clientExtId: extensions.determineExtensionFromCallStack().extensionId,
                pemUsed: 'openNotebook'
            });
            const controllers = serviceContainer.get<IControllerRegistration>(IControllerRegistration);
            const id = controllers.all.find((controller) => controller.id === kernelId)?.id;
            if (!id) {
                throw new Error(`Kernel ${kernelId} not found.`);
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
        },
        createJupyterServerCollection: (id: string, label: string, serverProvider: JupyterServerProvider) => {
            return createJupyterServerCollection(
                id,
                label,
                serverProvider,
                extensions.determineExtensionFromCallStack().extensionId
            );
        },
        get kernels() {
            return getKernelsApi(extensions.determineExtensionFromCallStack().extensionId);
        }
    };

    // In test/dev environment return the DI Container.
    if (
        isTestExecution() ||
        context.extensionMode === ExtensionMode.Development ||
        context.extensionMode === ExtensionMode.Test
    ) {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        (api as any).serviceContainer = serviceContainer;
        (api as any).serviceManager = serviceManager;
        /* eslint-enable @typescript-eslint/no-explicit-any */
    }
    return api;
}
