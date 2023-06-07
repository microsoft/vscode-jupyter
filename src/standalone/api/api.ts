// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ExtensionMode, NotebookController, NotebookDocument, Uri, commands, window, workspace } from 'vscode';
import { computeServerId, generateUriFromRemoteProvider } from '../../kernels/jupyter/jupyterUtils';
import { JupyterServerSelector } from '../../kernels/jupyter/connection/serverSelector';
import { IJupyterUriProviderRegistration } from '../../kernels/jupyter/types';
import { IDataViewerDataProvider, IDataViewerFactory } from '../../webviews/extension-side/dataviewer/types';
import { IExportedKernelService, IJupyterUriProvider, JupyterServerUriHandle } from '../../api';
import { IPythonApiProvider, PythonApi } from '../../platform/api/types';
import { isTestExecution, JVSC_EXTENSION_ID, Telemetry } from '../../platform/common/constants';
import { IDisposable, IExtensionContext, IExtensions } from '../../platform/common/types';
import { IServiceContainer, IServiceManager } from '../../platform/ioc/types';
import { traceError } from '../../platform/logging';
import { IControllerRegistration } from '../../notebooks/controllers/types';
import { sendTelemetryEvent } from '../../telemetry';
import { noop } from '../../platform/common/utils/misc';
import { isRemoteConnection } from '../../kernels/types';

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
    /**
     * Opens a notebook with a specific kernel as the active kernel.
     * @param {Uri} uri Uri of the notebook to open.
     * @param {String} kernelId Id of the kernel, retrieved from getKernelService().getKernelSpecifications()
     * @returns {Promise<NotebookDocument>} Promise that resolves to the notebook document.
     */
    openNotebook(uri: Uri, kernelId: string): Promise<NotebookDocument>;
}

function waitForNotebookControllersCreationForServer(
    serverId: string,
    controllerRegistration: IControllerRegistration
) {
    return new Promise<void>((resolve) => {
        controllerRegistration.onDidChange((e) => {
            for (let controller of e.added) {
                if (isRemoteConnection(controller.connection) && controller.connection.serverId === serverId) {
                    resolve();
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
                clientExtId: info.extensionId,
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
        registerRemoteServerProvider(provider: IJupyterUriProvider): IDisposable {
            sendApiUsageTelemetry(extensions, 'registerRemoteServerProvider');
            const container = serviceContainer.get<IJupyterUriProviderRegistration>(IJupyterUriProviderRegistration);
            let disposeHook = noop;
            const register = async () => {
                const extensions = serviceContainer.get<IExtensions>(IExtensions);
                const extensionId = provider.id.startsWith('_builtin')
                    ? JVSC_EXTENSION_ID
                    : (await extensions.determineExtensionFromCallStack()).extensionId;
                container.registerProvider(Object.assign(provider, { extensionId }));
            };
            register().catch(noop);
            return {
                dispose: () => {
                    disposeHook();
                }
            };
        },
        getKernelService: async () => {
            sendApiUsageTelemetry(extensions, 'getKernelService');
            const kernelServiceFactory =
                serviceContainer.get<IExportedKernelServiceFactory>(IExportedKernelServiceFactory);
            return kernelServiceFactory.getService();
        },
        getSuggestedController: async (
            _providerId: string,
            _handle: JupyterServerUriHandle,
            _notebook: NotebookDocument
        ) => {
            traceError('The API getSuggestedController is being deprecated.');
            if (context.extensionMode === ExtensionMode.Development || context.extensionMode === ExtensionMode.Test) {
                window.showErrorMessage('The Jupyter API getSuggestedController is being deprecated.').then(noop, noop);
                return;
            }
            sendApiUsageTelemetry(extensions, 'getSuggestedController');
            return undefined;
        },
        addRemoteJupyterServer: async (providerId: string, handle: JupyterServerUriHandle) => {
            sendApiUsageTelemetry(extensions, 'addRemoteJupyterServer');
            await new Promise<void>(async (resolve) => {
                const selector = serviceContainer.get<JupyterServerSelector>(JupyterServerSelector);
                const uri = generateUriFromRemoteProvider(providerId, handle);
                const serverId = await computeServerId(uri);

                const controllerRegistration = serviceContainer.get<IControllerRegistration>(IControllerRegistration);
                const controllerCreatedPromise = waitForNotebookControllersCreationForServer(
                    serverId,
                    controllerRegistration
                );

                await selector.addJupyterServer({ id: providerId, handle });
                await controllerCreatedPromise;
                resolve();
            });
        },
        openNotebook: async (uri: Uri, kernelId: string) => {
            sendApiUsageTelemetry(extensions, 'openNotebook');
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
