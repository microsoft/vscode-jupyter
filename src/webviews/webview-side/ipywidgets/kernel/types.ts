// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as jupyterlab from '@jupyter-widgets/base/lib';
import type { Kernel, KernelMessage } from '@jupyterlab/services';
import type * as nbformat from '@jupyterlab/nbformat';
import { ISignal } from '@lumino/signaling';
import { Widget } from '@lumino/widgets';
import { NotebookMetadata } from '../../../../platform/common/utils';

export type ScriptLoader = {
    readonly widgetsRegisteredInRequireJs: Readonly<Set<string>>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    errorHandler(className: string, moduleName: string, moduleVersion: string, error: any): void;
    loadWidgetScript(moduleName: string, moduleVersion: string): Promise<void>;
    successHandler(className: string, moduleName: string, moduleVersion: string): void;
};
export type IJupyterLabWidgetManagerCtor = new (
    kernel: Kernel.IKernelConnection,
    el: HTMLElement,
    scriptLoader: ScriptLoader,
    logger: (message: string) => void,
    widgetState?: NotebookMetadata['widgets']
) => IJupyterLabWidgetManager;

export type INotebookModel = {
    metadata: {
        get(key: 'widgets'): NotebookMetadata['widgets'];
    };
};

export interface IJupyterLabWidgetManager {
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
    get_model(model_id: string): Promise<jupyterlab.DOMWidgetModel> | undefined;
    /**
     * Display a DOMWidget view.
     *
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    display_view(msg: any, view: Backbone.View<Backbone.Model>, options: any): Promise<Widget>;
    /**
     * Creates a promise for a view of a given model
     *
     * Make sure the view creation is not out of order with
     * any state updates.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    create_view(model: jupyterlab.DOMWidgetModel, options: any): Promise<jupyterlab.DOMWidgetView>;
    /**
     * Restore widgets from kernel and saved state.
     * (for now loading state from kernel is not supported).
     */
    restoreWidgets(
        notebook: INotebookModel,
        options?: {
            loadKernel: false;
            loadNotebook: boolean;
        }
    ): Promise<void>;
}

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
     * Displays a widget for the mesasge with header.msg_type === 'display_data'.
     * The widget is rendered in a given HTML element.
     * Returns a disposable that can be used to dispose/remove the rendered Widget.
     * The message must
     *
     * @param {KernelMessage.IIOPubMessage} msg
     * @param {HTMLElement} ele
     * @returns {Promise<{ dispose: Function }>}
     * @memberof IIPyWidgetManager
     */
    renderWidget(data: nbformat.IMimeBundle, ele: HTMLElement): Promise<Widget | undefined>;
}
