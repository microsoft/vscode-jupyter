// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ExtensionMode, NotebookController, NotebookDocument } from 'vscode';
import { JupyterConnection } from '../../kernels/jupyter/jupyterConnection';
import { computeServerId, generateUriFromRemoteProvider } from '../../kernels/jupyter/jupyterUtils';
import { JupyterServerSelector } from '../../kernels/jupyter/serverSelector';
import {
    IJupyterUriProvider,
    IJupyterUriProviderRegistration,
    JupyterServerUriHandle
} from '../../kernels/jupyter/types';
import { IDataViewerDataProvider, IDataViewerFactory } from '../../webviews/extension-side/dataviewer/types';
import { IExportedKernelService } from './extension';
import { IPythonApiProvider, PythonApi } from '../../platform/api/types';
import { isTestExecution, Telemetry } from '../../platform/common/constants';
import { IExtensionContext, IExtensions } from '../../platform/common/types';
import { IServiceContainer, IServiceManager } from '../../platform/ioc/types';
import { traceError } from '../../platform/logging';
import { IControllerPreferredService, IControllerRegistration } from '../../notebooks/controllers/types';
import { sendTelemetryEvent } from '../../telemetry';
import { noop } from '../../platform/common/utils/misc';

export const IExportedKernelServiceFactory = Symbol('IExportedKernelServiceFactory');
export interface IExportedKernelServiceFactory {
    getService(): Promise<IExportedKernelService | undefined>;
}

/*
 * Do not introduce any breaking changes to this API.
 * This is the public API for other extensions to interact with this extension.
 */

export interface IExtensionApi {
    /**
     * Promise indicating whether all parts of the extension have completed loading or not.
     * @type {Promise<void>}
     * @memberof IExtensionApi
     */
    ready: Promise<void>;
    /**
     * Launches Data Viewer component.
     * @param {IDataViewerDataProvider} dataProvider Instance that will be used by the Data Viewer component to fetch data.
     * @param {string} title Data Viewer title
     */
    showDataViewer(dataProvider: IDataViewerDataProvider, title: string): Promise<void>;
    /**
     * Registers a remote server provider component that's used to pick remote jupyter server URIs
     * @param serverProvider object called back when picking jupyter server URI
     */
    registerRemoteServerProvider(serverProvider: IJupyterUriProvider): void;
    registerPythonApi(pythonApi: PythonApi): void;
    /**
     * Gets the service that provides access to kernels.
     * Returns `undefined` if the calling extension is not allowed to access this API. This could
     * happen either when user doesn't allow this or the extension doesn't allow this.
     * There are a specific set of extensions that are currently allowed to access this API.
     */
    getKernelService(): Promise<IExportedKernelService | undefined>;
    /**
     * Returns the suggested controller for a give Jupyter server and notebook.
     */
    getSuggestedController(
        providerId: string,
        handle: JupyterServerUriHandle,
        notebook: NotebookDocument
    ): Promise<NotebookController | undefined>;
    /**
     * Adds a remote Jupyter Server to the list of Remote Jupyter servers.
     * This will result in the Jupyter extension listing kernels from this server as items in the kernel picker.
     */
    addRemoteJupyterServer(providerId: string, handle: JupyterServerUriHandle): Promise<void>;
}

function waitForNotebookControllersCreationForServer(
    serverId: string,
    controllerRegistration: IControllerRegistration
) {
    return new Promise<void>((resolve) => {
        controllerRegistration.onDidChange((e) => {
            for (let controller of e.added) {
                if (
                    controller.connection.kind === 'connectToLiveRemoteKernel' ||
                    controller.connection.kind === 'startUsingRemoteKernelSpec'
                ) {
                    if (controller.connection.serverId === serverId) {
                        resolve();
                    }
                }
            }
        });
    });
}

function sendApiUsageTelemetry(extensions: IExtensions, pemUsed: keyof IExtensionApi) {
    extensions
        .determineExtensionFromCallStack()
        .then((info) => {
            sendTelemetryEvent(Telemetry.JupyterApiUsage, undefined, {
                extensionId: info.extensionId,
                pemUsed
            });
        })
        .catch(noop);
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
        async showDataViewer(dataProvider: IDataViewerDataProvider, title: string): Promise<void> {
            sendApiUsageTelemetry(extensions, 'showDataViewer');
            const dataViewerProviderService = serviceContainer.get<IDataViewerFactory>(IDataViewerFactory);
            await dataViewerProviderService.create(dataProvider, title);
        },
        registerRemoteServerProvider(picker: IJupyterUriProvider): void {
            sendApiUsageTelemetry(extensions, 'registerRemoteServerProvider');
            const container = serviceContainer.get<IJupyterUriProviderRegistration>(IJupyterUriProviderRegistration);
            container.registerProvider(picker);
        },
        getKernelService: async () => {
            sendApiUsageTelemetry(extensions, 'getKernelService');
            const kernelServiceFactory =
                serviceContainer.get<IExportedKernelServiceFactory>(IExportedKernelServiceFactory);
            return kernelServiceFactory.getService();
        },
        getSuggestedController: async (
            providerId: string,
            handle: JupyterServerUriHandle,
            notebook: NotebookDocument
        ) => {
            sendApiUsageTelemetry(extensions, 'getSuggestedController');
            const controllers = serviceContainer.get<IControllerPreferredService>(IControllerPreferredService);
            const controllerRegistration = serviceContainer.get<IControllerRegistration>(IControllerRegistration);
            const connection = serviceContainer.get<JupyterConnection>(JupyterConnection);
            const uri = generateUriFromRemoteProvider(providerId, handle);
            const serverId = await computeServerId(uri);

            if (
                controllerRegistration.all.find(
                    (metadata) =>
                        (metadata.kind === 'connectToLiveRemoteKernel' ||
                            metadata.kind === 'startUsingRemoteKernelSpec') &&
                        metadata.serverId === serverId
                ) !== undefined
            ) {
                // initial kernel detection finished already
                await connection.updateServerUri(uri);
                const { controller } = await controllers.computePreferred(notebook, serverId);
                return controller?.controller;
            } else {
                // initial kernel detection didn't finish yet, wait for the first set of kernels to be registered
                const controllerCreatedPromise = waitForNotebookControllersCreationForServer(
                    serverId,
                    controllerRegistration
                );

                await connection.updateServerUri(uri);
                await controllerCreatedPromise;
                const { controller } = await controllers.computePreferred(notebook, serverId);
                return controller?.controller;
            }
        },
        addRemoteJupyterServer: async (providerId: string, handle: JupyterServerUriHandle) => {
            sendApiUsageTelemetry(extensions, 'addRemoteJupyterServer');
            await new Promise<void>(async (resolve) => {
                const connection = serviceContainer.get<JupyterConnection>(JupyterConnection);
                const selector = serviceContainer.get<JupyterServerSelector>(JupyterServerSelector);
                const uri = generateUriFromRemoteProvider(providerId, handle);
                const serverId = await computeServerId(uri);

                const controllerRegistration = serviceContainer.get<IControllerRegistration>(IControllerRegistration);
                const controllerCreatedPromise = waitForNotebookControllersCreationForServer(
                    serverId,
                    controllerRegistration
                );

                await connection.updateServerUri(uri);
                await selector.setJupyterURIToRemote(uri);

                if (
                    controllerRegistration.all.find(
                        (metadata) =>
                            (metadata.kind === 'connectToLiveRemoteKernel' ||
                                metadata.kind === 'startUsingRemoteKernelSpec') &&
                            metadata.serverId === serverId
                    ) === undefined
                ) {
                    resolve();
                    return;
                } else {
                    await controllerCreatedPromise;
                    resolve();
                }
            });
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
