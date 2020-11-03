// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import type { DOMWidgetModel, DOMWidgetView, IWidgetRegistryData } from '@jupyter-widgets/base/lib';
// import type { WidgetManager } from '@jupyter-widgets/jupyterlab-manager';
import type { Kernel, KernelMessage } from '@jupyterlab/services';
import type { ISignal } from '@phosphor/signaling';
// import type { nbformat } from '@jupyterlab/services/node_modules/@jupyterlab/coreutils';
import type { Widget } from '@phosphor/widgets';

// tslint:disable: interface-name no-any

export type IJupyterLabWidgetManagerCtor = new (
    kernel: Kernel.IKernelConnection,
    el: HTMLElement,
    scriptLoader: {
        // tslint:disable-next-line: no-any
        errorHandler(className: string, moduleName: string, moduleVersion: string, error: any): void;
    }
) => JupyterLabWidgetManager;
// export type JupyterLabWidgetManager = any;
export interface JupyterLabWidgetManager {
    /**
     * Signal emitted when a view emits an IO Pub message but nothing handles it.
     */
    readonly onUnhandledIOPubMessage: ISignal<this, KernelMessage.IIOPubMessage>;
    dispose(): void;
    /**
     * Close all widgets and empty the widget state.
     * @return Promise that resolves when the widget state is cleared.
     */
    clear_state(): Promise<void>;
    /**
     * Get a promise for a model by model id.
     *
     * #### Notes
     * If a model is not found, undefined is returned (NOT a promise). However,
     * the calling code should also deal with the case where a rejected promise
     * is returned, and should treat that also as a model not found.
     */
    get_model(model_id: string): Promise<DOMWidgetModel> | undefined;
    /**
     * Display a DOMWidget view.
     *
     */
    // tslint:disable-next-line: no-any
    display_view(msg: any, view: Backbone.View<Backbone.Model>, options: any): Promise<Widget>;
    /**
     * Creates a promise for a view of a given model
     *
     * Make sure the view creation is not out of order with
     * any state updates.
     */
    // tslint:disable-next-line: no-any
    create_view(model: DOMWidgetModel, options: any): Promise<DOMWidgetView>;
    register(data: IWidgetRegistryData): void;
}

export type LoadIPyWidgetClassLoadAction = {
    className: string;
    moduleName: string;
    moduleVersion: string;
};
export type NotifyIPyWidgeWidgetVersionNotSupportedAction = {
    moduleName: 'qgrid';
    moduleVersion: string;
};

export interface ILoadIPyWidgetClassFailureAction {
    className: string;
    moduleName: string;
    moduleVersion: string;
    cdnsUsed: boolean;
    isOnline: boolean;
    // tslint:disable-next-line: no-any
    error: any;
    timedout: boolean;
}

export interface IDisposable {
    dispose(): void;
}

export type Event<T> = (listener: (e: T) => any, thisArgs?: any, disposables?: IDisposable[]) => IDisposable;

export type IPyWidgetsSettings = {
    /**
     * Total time to wait for a script to load. This includes ipywidgets making a request to extension for a Uri of a widget,
     * then extension replying back with the Uri (max 5 seconds round trip time).
     * If expires, then Widget downloader will attempt to download with what ever information it has (potentially failing).
     * Note, we might have a message displayed at the user end (asking for consent to use CDN).
     * Hence use 60 seconds.
     */
    timeoutWaitingForWidgetsToLoad?: number;
};
export interface IPyWidgetsPostOffice {
    readonly settings?: IPyWidgetsSettings;
    /**
     * Called when the backend Kernel sends a message to the front end kernel.
     */
    onDidReceiveKernelMessage: Event<any>;
    /**
     * Sends a message to the backend where real kernel lives.
     */
    postKernelMessage<
        E extends keyof IPostOfficeKernelMessagePayloadMapping,
        U extends IPostOfficeKernelMessagePayloadMapping[E]
    >(
        type: E,
        payload: U
    ): void;

    getWidgetScriptSource(options: { moduleName: string; moduleVersion: string }): Promise<WidgetScriptSource>;
    /**
     * Invoked when IPyWidgets is ready.
     */
    onReady(): void;
    /**
     * Invoked when loading a widget fails.
     */
    onWidgetLoadFailure?(info: ILoadIPyWidgetClassFailureAction): void;
    /**
     * Invoked when a widget has been loaded successfully.
     */
    onWidgetLoadSuccess?(info: LoadIPyWidgetClassLoadAction): void;
    /**
     * Invoked when the version of a module associated with a widget is not supported.
     */
    onWidgetVersionNotSupported?(info: NotifyIPyWidgeWidgetVersionNotSupportedAction): void;
    /**
     * Invoked when we have a kernel message that was not handled.
     */
    onUnhandledKernelMessage?(message: KernelMessage.IIOPubMessage): void;
}

export type KernelSocketOptions = {
    /**
     * Kernel Id.
     */
    readonly id: string;
    /**
     * Kernel ClientId.
     */
    readonly clientId: string;
    /**
     * Kernel UserName.
     */
    readonly userName: string;
    /**
     * Kernel model.
     */
    readonly model: {
        /**
         * Unique identifier of the kernel server session.
         */
        readonly id: string;
        /**
         * The name of the kernel.
         */
        readonly name: string;
    };
};

export enum IPyWidgetMessages {
    IPyWidgets_Ready = 'IPyWidgets_Ready',
    IPyWidgets_onRestartKernel = 'IPyWidgets_onRestartKernel',
    IPyWidgets_onKernelChanged = 'IPyWidgets_onKernelChanged',
    IPyWidgets_updateRequireConfig = 'IPyWidgets_updateRequireConfig',
    /**
     * UI sends a request to extension to determine whether we have the source for any of the widgets.
     */
    IPyWidgets_WidgetScriptSourceRequest = 'IPyWidgets_WidgetScriptSourceRequest',
    /**
     * Extension sends response to the request with yes/no.
     */
    IPyWidgets_WidgetScriptSourceResponse = 'IPyWidgets_WidgetScriptSourceResponse',
    IPyWidgets_msg = 'IPyWidgets_msg',
    IPyWidgets_binary_msg = 'IPyWidgets_binary_msg',
    // Message was received by the widget kernel and added to the msgChain queue for processing
    IPyWidgets_msg_received = 'IPyWidgets_msg_received',
    // IOPub message was fully handled by the widget kernel
    IPyWidgets_iopub_msg_handled = 'IPyWidgets_iopub_msg_handled',
    IPyWidgets_kernelOptions = 'IPyWidgets_kernelOptions',
    IPyWidgets_registerCommTarget = 'IPyWidgets_registerCommTarget',
    IPyWidgets_RegisterMessageHook = 'IPyWidgets_RegisterMessageHook',
    // Message sent when the extension has finished an operation requested by the kernel UI for processing a message
    IPyWidgets_ExtensionOperationHandled = 'IPyWidgets_ExtensionOperationHandled',
    IPyWidgets_RemoveMessageHook = 'IPyWidgets_RemoveMessageHook',
    IPyWidgets_MessageHookCall = 'IPyWidgets_MessageHookCall',
    IPyWidgets_MessageHookResult = 'IPyWidgets_MessageHookResult',
    IPyWidgets_mirror_execute = 'IPyWidgets_mirror_execute'
}

export interface IPostOfficeKernelMessagePayloadMapping {
    [IPyWidgetMessages.IPyWidgets_Ready]: never | undefined;
    [IPyWidgetMessages.IPyWidgets_msg]: string | ArrayBuffer | SharedArrayBuffer | Blob | ArrayBufferView;
    [IPyWidgetMessages.IPyWidgets_binary_msg]: any[] | undefined;
    [IPyWidgetMessages.IPyWidgets_registerCommTarget]: string;
    [IPyWidgetMessages.IPyWidgets_msg_received]: { id: string };
    [IPyWidgetMessages.IPyWidgets_iopub_msg_handled]: { id: string };
    [IPyWidgetMessages.IPyWidgets_RegisterMessageHook]: string;
    [IPyWidgetMessages.IPyWidgets_MessageHookResult]: {
        requestId: string;
        parentId: string;
        msgType: KernelMessage.IOPubMessageType;
        result: boolean;
    };
    [IPyWidgetMessages.IPyWidgets_RemoveMessageHook]: {
        hookMsgId: string;
        lastHookedMsgId?: string;
    };
}

export type CommTargetCallback = (comm: Kernel.IComm, msg: KernelMessage.ICommOpenMsg) => void | PromiseLike<void>;

// export interface IIPyWidgetManager extends IMessageHandler {
export interface IIPyWidgetManager {
    dispose(): void;
    /**
     * Clears/removes all the widgets
     *
     * @memberof IIPyWidgetManager
     */
    clear(): Promise<void>;
    /**
     * Displays a widget for the message with header.msg_type === 'display_data'.
     * The widget is rendered in a given HTML element.
     * Returns a disposable that can be used to dispose/remove the rendered Widget.
     * The message must
     *
     * @param {KernelMessage.IIOPubMessage} msg
     * @param {HTMLElement} ele
     * @returns {Promise<{ dispose: Function }>}
     * @memberof IIPyWidgetManager
     */
    // renderWidget(data: nbformat.IMimeBundle, ele: HTMLElement): Promise<Widget | undefined>;
    renderWidget(data: any, ele: HTMLElement): Promise<Widget | undefined>;
}

/**
 * Name value pair of widget name/module along with the Uri to the script.
 */
export type WidgetScriptSource = {
    moduleName: string;
    /**
     * Where is the script being source from.
     */
    source?: 'cdn' | 'local' | 'remote';
    /**
     * Resource Uri (not using Uri type as this needs to be sent from extension to UI).
     */
    scriptUri?: string;
};

export enum SharedMessages {
    UpdateSettings = 'update_settings',
    Started = 'started',
    LocInit = 'loc_init',
    StyleUpdate = 'style_update'
}
