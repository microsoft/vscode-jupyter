// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ExtensionMode, Uri } from 'vscode';
import { PythonApi } from '../../platform/api/types';
import { isTestExecution } from '../../platform/common/constants';
import { IExtensionContext, IExtensions } from '../../platform/common/types';
import { IServiceContainer, IServiceManager } from '../../platform/ioc/types';
import { Jupyter, IJupyterUriProvider, JupyterServerProvider } from '../../api';
import { getKernelsApi } from './kernels';
import { EnvironmentPath } from '@vscode/python-extension';
import { createJupyterServerCollection } from './servers';
import { registerPythonApi } from './pythonExtension';
import {
    addRemoteJupyterServer,
    getKernelService,
    getReady,
    openNotebook,
    registerRemoteServerProvider
} from './unstable';

/*
 * Do not introduce any breaking changes to this API.
 * This is the public API for other extensions to interact with this extension.
 */

export interface IExtensionApi extends Jupyter {}

export function buildApi(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ready: Promise<any>,
    serviceManager: IServiceManager,
    serviceContainer: IServiceContainer,
    context: IExtensionContext
): IExtensionApi {
    const extensions = serviceContainer.get<IExtensions>(IExtensions);
    const api: IExtensionApi = {
        // 'ready' will propagate the exception, but we must log it here first.
        ready: getReady(ready),
        registerPythonApi: (pythonApi: PythonApi) => registerPythonApi(pythonApi, serviceContainer),
        registerRemoteServerProvider: (provider: IJupyterUriProvider) =>
            registerRemoteServerProvider(provider, serviceContainer),
        getKernelService: () => getKernelService(serviceContainer),
        addRemoteJupyterServer: (providerId: string, handle: string) =>
            addRemoteJupyterServer(providerId, handle, serviceContainer),
        openNotebook: async (uri: Uri, kernelOrPythonEnvId: string | EnvironmentPath) =>
            openNotebook(uri, kernelOrPythonEnvId, serviceContainer),
        createJupyterServerCollection: (id: string, label: string, serverProvider: JupyterServerProvider) => {
            return createJupyterServerCollection(
                id,
                label,
                serverProvider,
                extensions.determineExtensionFromCallStack().extensionId,
                serviceContainer
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
