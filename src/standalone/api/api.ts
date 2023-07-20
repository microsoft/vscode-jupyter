// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ExtensionMode, NotebookDocument, Uri, commands, window, workspace } from 'vscode';
import { JupyterServerSelector } from '../../kernels/jupyter/connection/serverSelector';
import { IJupyterUriProviderRegistration } from '../../kernels/jupyter/types';
import { IDataViewerDataProvider, IDataViewerFactory } from '../../webviews/extension-side/dataviewer/types';
import { IExportedKernelService, IJupyterUriProvider, JupyterAPI as UnStableJupyterAPI } from '../../api.unstable';
import { IPythonApiProvider, PythonApi } from '../../platform/api/types';
import { isTestExecution, JVSC_EXTENSION_ID, Telemetry } from '../../platform/common/constants';
import { IDisposable, IExtensionContext, IExtensions } from '../../platform/common/types';
import { IServiceContainer, IServiceManager } from '../../platform/ioc/types';
import { traceError } from '../../platform/logging';
import { IControllerRegistration } from '../../notebooks/controllers/types';
import { sendTelemetryEvent } from '../../telemetry';
import { noop } from '../../platform/common/utils/misc';
import { isRemoteConnection } from '../../kernels/types';
import { JupyterAPI } from '../../api';
import { JupyterAPI as ProposedJupyterAPI } from '../../api.proposed';
import { createServerCollection } from './serverCollection';

export const IExportedKernelServiceFactory = Symbol('IExportedKernelServiceFactory');
export interface IExportedKernelServiceFactory {
    getService(): Promise<IExportedKernelService | undefined>;
}

/*
 * Do not introduce any breaking changes to this API.
 * This is the public API for other extensions to interact with this extension.
 */

export interface IExtensionApi extends JupyterAPI, UnStableJupyterAPI, ProposedJupyterAPI {}

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
                const disposable = container.registerProvider(provider, extensionId);
                disposeHook = () => disposable.dispose();
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
        getSuggestedController: async (_providerId: string, _handle: string, _notebook: NotebookDocument) => {
            traceError('The API getSuggestedController is being deprecated.');
            if (context.extensionMode === ExtensionMode.Development || context.extensionMode === ExtensionMode.Test) {
                window.showErrorMessage('The Jupyter API getSuggestedController is being deprecated.').then(noop, noop);
                return;
            }
            sendApiUsageTelemetry(extensions, 'getSuggestedController');
            return undefined;
        },
        addRemoteJupyterServer: async (providerId: string, handle: string) => {
            sendApiUsageTelemetry(extensions, 'addRemoteJupyterServer');
            await new Promise<void>(async (resolve) => {
                const selector = serviceContainer.get<JupyterServerSelector>(JupyterServerSelector);

                const controllerRegistration = serviceContainer.get<IControllerRegistration>(IControllerRegistration);
                const controllerCreatedPromise = waitForNotebookControllersCreationForServer(
                    { id: providerId, handle },
                    controllerRegistration
                );
                const extensionId = (await extensions.determineExtensionFromCallStack()).extensionId;

                await selector.addJupyterServer({ id: providerId, handle, extensionId });
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
        },
        createServerCollection: async (id: string, label: string) => {
            const { extensionId } = await extensions.determineExtensionFromCallStack();
            sendTelemetryEvent(Telemetry.JupyterApiUsage, undefined, {
                clientExtId: extensionId,
                pemUsed: 'createServerCollection'
            });
            return createServerCollection(serviceContainer, context, extensionId, id, label);
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
