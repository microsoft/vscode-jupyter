// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import type { ISignal, Slot } from '@phosphor/signaling';
import * as fastDeepEqual from 'fast-deep-equal';
import { Kernel, KernelMessage } from '@jupyterlab/services';
import { JSONObject } from '@phosphor/coreutils';
import {
    CancellationToken,
    Disposable,
    Event,
    NotebookCell,
    NotebookCommunication,
    NotebookDocument,
    Uri,
    window
} from 'vscode';
import { ServerStatus } from '../datascience-ui/interactive-common/mainState';
import { IPythonApiProvider, PythonApi } from './api/types';
import { isTestExecution } from './common/constants';
import { traceError } from './common/logger';
import { createDeferred } from './common/utils/async';
import { VSCodeNotebookProvider } from './datascience/constants';
import { IDataViewerDataProvider, IDataViewerFactory } from './datascience/data-viewing/types';
import { CellExecution } from './datascience/jupyter/kernels/cellExecution';
import { IKernelProvider, NotebookCellRunState } from './datascience/jupyter/kernels/types';
import { CreationOptionService } from './datascience/notebook/creation/creationOptionsService';
import { KernelStateEventArgs } from './datascience/notebookExtensibility';
import {
    IJupyterSession,
    IJupyterUriProvider,
    IJupyterUriProviderRegistration,
    INotebookEditorProvider,
    INotebookExtensibility,
    IWebviewExtensibility
} from './datascience/types';
import { IServiceContainer, IServiceManager } from './ioc/types';
import { INotebookKernelResolver } from './datascience/notebook/types';

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
     * Do not use this to monitor execution state of cells of Native Notebooks (use VS Code API).
     */
    readonly onKernelStateChange: Event<KernelStateEventArgs>;
    /**
     * Do not use this to register Cell Toolbar icons for Native Notebook.
     */
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
    }): Promise<void>;
    /**
     * Creates a blank notebook and defaults the empty cell to the language provided.
     */
    createBlankNotebook(options: { defaultCellLanguage: string }): Promise<void>;
    registerCellExecutionHandler(
        cb: (cell: NotebookCell, args: Parameters<Kernel.IKernelConnection['requestExecute']>) => void
    ): void;
    getKernel(
        notebook: NotebookDocument
    ): Promise<
        | undefined
        | Pick<Kernel.IKernel, 'isReady' | 'ready' | 'requestExecute' | 'iopubMessage' | 'statusChanged' | 'status'>
    >;
    initializeWebViewKernel(
        document: NotebookDocument,
        webview: NotebookCommunication,
        token: CancellationToken
    ): Promise<void>;
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
            return serviceContainer
                .get<CreationOptionService>(CreationOptionService)
                .registerNewNotebookContent(options);
        },
        createBlankNotebook: async (options: { defaultCellLanguage: string }): Promise<void> => {
            const service = serviceContainer.get<INotebookEditorProvider>(VSCodeNotebookProvider);
            await service.createNew(options);
        },
        registerCellExecutionHandler(
            cb: (cell: NotebookCell, args: Parameters<Kernel.IKernelConnection['requestExecute']>) => void
        ): void {
            CellExecution.onPreExecuteCell(async (e) => {
                const originalData: typeof e.args = JSON.parse(JSON.stringify(e.args));
                cb(e.cell, e.args);
                const updatedData = JSON.parse(JSON.stringify(e.args));
                if (!fastDeepEqual(originalData, updatedData)) {
                    const deferred = createDeferred<void>();
                    // Possible we have multiple listeners.
                    if (e.handled) {
                        e.handled = e.handled.then(() => deferred.promise);
                    } else {
                        e.handled = deferred.promise;
                    }
                    const selection = await window.showWarningMessage(
                        'Do you want Extension A to be able to modify the code prior to execution',
                        { modal: true },
                        'Yes',
                        'No'
                    );
                    if (selection != 'Yes') {
                        e.args = originalData;
                    }
                    deferred.resolve();
                }
            });
        },
        initializeWebViewKernel(document: NotebookDocument, webview: NotebookCommunication, token: CancellationToken) {
            const resolver = serviceContainer.get<INotebookKernelResolver>(INotebookKernelResolver);
            return resolver.resolveKernel(document, webview, token);
        },
        getKernel: async (
            notebook: NotebookDocument
        ): Promise<
            | undefined
            | Pick<Kernel.IKernel, 'isReady' | 'ready' | 'requestExecute' | 'iopubMessage' | 'status' | 'statusChanged'>
        > => {
            const kernelProvider = serviceContainer.get<IKernelProvider>(IKernelProvider);
            const kernel = kernelProvider.get(notebook.uri);
            if (!kernel) {
                return;
            }
            const session = await kernel.session;
            if (!session) {
                return;
            }

            class ProxyKernel {
                get isReady() {
                    return this.session.status === ServerStatus.Idle;
                }
                get status(): Kernel.Status {
                    return sessionStatusToKernelStatus(this.session.status);
                }
                get ready(): Promise<void> {
                    if (this.session.status === ServerStatus.Idle) {
                        return Promise.resolve();
                    }
                    const deferred = createDeferred<void>();
                    const timer = setInterval(() => {
                        if (this.session.status === ServerStatus.Idle) {
                            return deferred.resolve();
                        }
                        clearInterval(timer);
                    }, 1000);
                    return deferred.promise;
                }
                get iopubMessage(): ISignal<Kernel.IKernel, KernelMessage.IIOPubMessage> {
                    return this.iopubMessageSignal;
                }
                get statusChanged(): ISignal<Kernel.IKernel, Kernel.Status> {
                    return this.kernelStatusSignal;
                }
                // eslint-disable-next-line @typescript-eslint/no-use-before-define
                private readonly iopubMessageSignal = new Signal<Kernel.IKernel, KernelMessage.IIOPubMessage>();
                // eslint-disable-next-line @typescript-eslint/no-use-before-define
                private readonly kernelStatusSignal = new Signal<Kernel.IKernel, Kernel.Status>();
                constructor(private readonly session: IJupyterSession) {
                    if (session.onIOPubMessage) {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        session.onIOPubMessage((e) => this.iopubMessageSignal.fire(this as any, e));
                    }
                    session.onSessionStatusChanged((e) => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        this.kernelStatusSignal.fire(this as any, sessionStatusToKernelStatus(e));
                    });
                }
                requestExecute(
                    content: KernelMessage.IExecuteRequestMsg['content'],
                    disposeOnDone?: boolean,
                    metadata?: JSONObject
                ): Kernel.IShellFuture<KernelMessage.IExecuteRequestMsg, KernelMessage.IExecuteReplyMsg> {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return this.session.requestExecute(content, disposeOnDone, metadata) as any;
                }
            }
            return new ProxyKernel(session);
        }
    };

    // In test environment return the DI Container.
    if (isTestExecution() || process.env.VSC_JUPYTER_EXPOSE_SVC) {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        (api as any).serviceContainer = serviceContainer;
        (api as any).serviceManager = serviceManager;
        /* eslint-enable @typescript-eslint/no-explicit-any */
    }
    return api;
}

class Signal<T, S> implements ISignal<T, S> {
    private slots: Set<Slot<T, S>> = new Set<Slot<T, S>>();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public connect(slot: Slot<T, S>, thisArg?: any): boolean {
        const bound = thisArg ? slot.bind(thisArg) : slot;
        this.slots.add(bound);
        return true;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public disconnect(slot: Slot<T, S>, thisArg?: any): boolean {
        const bound = thisArg ? slot.bind(thisArg) : slot;
        this.slots.delete(bound);
        return true;
    }

    public fire(sender: T, args: S): void {
        this.slots.forEach((s) => s(sender, args));
    }
}
function sessionStatusToKernelStatus(status: ServerStatus) {
    switch (status) {
        case ServerStatus.Busy:
            return 'busy';
        case ServerStatus.Dead:
            return 'dead';
        case ServerStatus.Idle:
            return 'idle';
        case ServerStatus.NotStarted:
            return 'unknown';
        case ServerStatus.Restarting:
            return 'restarting';
        case ServerStatus.Starting:
            return 'starting';
        default:
            return 'unknown';
    }
}
