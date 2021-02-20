// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { Disposable, Event, Uri } from 'vscode';
import { NotebookCell, NotebookCellRunState } from '../../types/vscode-proposed';
import { IPythonApiProvider, PythonApi } from './api/types';
import { isTestExecution } from './common/constants';
import { traceError } from './common/logger';
import { VSCodeNotebookProvider } from './datascience/constants';
import { IDataViewerDataProvider, IDataViewerFactory } from './datascience/data-viewing/types';
import { CreationOptionService } from './datascience/notebook/creation/creationOptionsService';
import { KernelStateEventArgs } from './datascience/notebookExtensibility';
import {
    IJupyterUriProvider,
    IJupyterUriProviderRegistration,
    INotebookEditorProvider,
    INotebookExtensibility,
    IWebviewExtensibility
} from './datascience/types';
import { IServiceContainer, IServiceManager } from './ioc/types';

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
    readonly onKernelStateChange: Event<KernelStateEventArgs>;
    registerCellToolbarButton(
        callback: (cell: NotebookCell, isInteractive: boolean, resource: Uri) => Promise<void>,
        codicon: string,
        statusToEnable: NotebookCellRunState[],
        tooltip: string
    ): Disposable;
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
     * When called by other extensions we will display these extensions in a dropdown list when creating a new notebook.
     */
    registerNewNotebookContent(options: {
        /**
         * Use this language as the language of cells for new notebooks created (when user picks this extension).
         */
        defaultCellLanguage: string;
        /**
         * Value in the quickpick (if not provided, will use the displayName of the extension).
         */
        label: string;
    }): void;
    /**
     * Creates a blank notebook and defaults the empty cell to the language provided.
     */
    createBlankNotebook(options: { defaultCellLanguage: string }): Promise<void>;
}

export function buildApi(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ready: Promise<any>,
    serviceManager: IServiceManager,
    serviceContainer: IServiceContainer
): IExtensionApi {
    const notebookExtensibility = serviceContainer.get<INotebookExtensibility>(INotebookExtensibility);
    const webviewExtensibility = serviceContainer.get<IWebviewExtensibility>(IWebviewExtensibility);
    let registered = false;
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
            const dataViewerProviderService = serviceContainer.get<IDataViewerFactory>(IDataViewerFactory);
            await dataViewerProviderService.create(dataProvider, title);
        },
        registerRemoteServerProvider(picker: IJupyterUriProvider): void {
            const container = serviceContainer.get<IJupyterUriProviderRegistration>(IJupyterUriProviderRegistration);
            container.registerProvider(picker);
        },
        onKernelStateChange: notebookExtensibility.onKernelStateChange.bind(notebookExtensibility),
        registerCellToolbarButton: webviewExtensibility.registerCellToolbarButton.bind(webviewExtensibility),
        registerNewNotebookContent(options: { defaultCellLanguage: string; label?: string }) {
            serviceContainer.get<CreationOptionService>(CreationOptionService).registerNewNotebookContent(options);
        },
        createBlankNotebook: async (options: { defaultCellLanguage: string }): Promise<void> => {
            const service = serviceContainer.get<INotebookEditorProvider>(VSCodeNotebookProvider);
            await service.createNew(options);
        }
    };

    // In test environment return the DI Container.
    if (isTestExecution()) {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        (api as any).serviceContainer = serviceContainer;
        (api as any).serviceManager = serviceManager;
        /* eslint-enable @typescript-eslint/no-explicit-any */
    }
    return api;
}
