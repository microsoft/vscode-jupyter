// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

// import '@jupyter-widgets/controls/css/labvariables.css';

// import type { WidgetManager as JupyterlabWidgetManager } from '@jupyter-widgets/jupyterlab-manager';
import type { Kernel, KernelMessage } from '@jupyterlab/services';
import type { nbformat } from '@jupyterlab/services/node_modules/@jupyterlab/coreutils';
import { Widget } from '@phosphor/widgets';
// tslint:disable-next-line: match-default-export-name
import fastDeepEqual from 'fast-deep-equal';
import 'rxjs/add/operator/concatMap';
import { Observable } from 'rxjs/Observable';
import { ReplaySubject } from 'rxjs/ReplaySubject';
import { create as createKernel } from './kernel';
import { createDeferred, Deferred } from './misc/async';
import { IJupyterLabWidgetManagerCtor, IPyWidgetMessages, JupyterLabWidgetManager } from './types';
// tslint:disable-next-line: no-duplicate-imports
import { IDisposable, IIPyWidgetManager, IPyWidgetsPostOffice, KernelSocketOptions } from './types';

// eslint-disable-next-line @typescript-eslint/no-empty-function, no-empty
const noop = () => {};
export const WIDGET_MIMETYPE = 'application/vnd.jupyter.widget-view+json';

// import * as base from '@jupyter-widgets/base';
// import * as widgets from '@jupyter-widgets/controls';
// import { JUPYTER_CONTROLS_VERSION } from '@jupyter-widgets/controls/lib/version';
// import * as outputWidgets from '@jupyter-widgets/jupyterlab-manager/lib/output';
// import './widgets.css';

// Export the following for `requirejs`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any, no-empty, @typescript-eslint/no-empty-function
// const define = (window as any).define || function () {};
// define('@jupyter-widgets/controls', () => widgets);
// define('@jupyter-widgets/base', () => base);
// define('@jupyter-widgets/output', () => outputWidgets);

export function createManager(a: any, b: any, c: any) {
    // tslint:disable-next-line: no-use-before-declare
    return new WidgetManager(a, b, c);
}
export function getInstance() {
    // tslint:disable-next-line: no-use-before-declare
    return WidgetManager.instance;
}
// tslint:disable: no-any

class WidgetManager implements IIPyWidgetManager {
    public static get instance(): Observable<WidgetManager | undefined> {
        return WidgetManager._instance;
    }
    private static _instance = new ReplaySubject<WidgetManager | undefined>();
    public proxyKernel?: Kernel.IKernel;
    private manager?: JupyterLabWidgetManager;
    private options?: KernelSocketOptions;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private pendingMessages: { message: string; payload: any }[] = [];
    /**
     * Contains promises related to model_ids that need to be displayed.
     * When we receive a message from the kernel of type = `display_data` for a widget (`application/vnd.jupyter.widget-view+json`),
     * then its time to display this.
     * We need to keep track of this. A boolean is sufficient, but we're using a promise so we can be notified when it is ready.
     *
     * @private
     * @memberof WidgetManager
     */
    private modelIdsToBeDisplayed = new Map<string, Deferred<void>>();
    private disposables: IDisposable[] = [];
    private wait = Promise.resolve();
    constructor(
        private readonly widgetContainer: HTMLElement,
        private readonly postOffice: IPyWidgetsPostOffice,
        private readonly scriptLoader: {
            readonly widgetsRegisteredInRequireJs: Readonly<Set<string>>;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            errorHandler(className: string, moduleName: string, moduleVersion: string, error: any): void;
            loadWidgetScript(moduleName: string, moduleVersion: string): Promise<void>;
            successHandler(className: string, moduleName: string, moduleVersion: string): void;
        }
    ) {
        this.postOffice.onDidReceiveKernelMessage(this.handleMessage, this, this.disposables);

        // Handshake.
        this.postOffice.onReady();
        this.postOffice.postKernelMessage(IPyWidgetMessages.IPyWidgets_Ready, undefined);
    }
    public dispose(): void {
        this.proxyKernel?.dispose(); // NOSONAR
        this.disposables.forEach((d) => d.dispose());
        this.clear().then(noop, noop);
    }
    public async clear(): Promise<void> {
        await this.manager?.clear_state();
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public async handleMessage(msg: { type: string; payload?: any }) {
        await this.wait;
        // tslint:disable-next-line: no-console
        // console.error('handleMessage in manager.ts', msg);
        const { type, payload } = msg;
        // console.error('handleMessage in manager.ts', msg);
        if (type === IPyWidgetMessages.IPyWidgets_kernelOptions) {
            this.initializeKernelAndWidgetManager(payload);
        } else if (type === IPyWidgetMessages.IPyWidgets_onRestartKernel) {
            // Kernel was restarted.
            this.manager?.dispose(); // NOSONAR
            this.manager = undefined;
            this.proxyKernel?.dispose(); // NOSONAR
            this.proxyKernel = undefined;
            WidgetManager._instance.next(undefined);
        } else if (!this.proxyKernel) {
            this.pendingMessages.push({ message: type, payload });
        }
        return true;
    }

    /**
     * Renders a widget and returns a disposable (to remove the widget).
     *
     * @param {(nbformat.IMimeBundle & {model_id: string; version_major: number})} data
     * @param {HTMLElement} ele
     * @returns {Promise<{ dispose: Function }>}
     * @memberof WidgetManager
     */
    public async renderWidget(
        data: nbformat.IMimeBundle & { model_id: string; version_major: number },
        ele: HTMLElement
    ): Promise<Widget | undefined> {
        console.error('WidgetManager.renderWidget');
        if (!data) {
            throw new Error(
                "application/vnd.jupyter.widget-view+json not in msg.content.data, as msg.content.data is 'undefined'."
            );
        }
        if (!this.manager) {
            throw new Error('DS IPyWidgetManager not initialized.');
        }

        if (!data || data.version_major !== 2) {
            console.warn('Widget data not available to render an ipywidget');
            return undefined;
        }

        const modelId = data.model_id as string;
        // Check if we have processed the data for this model.
        // If not wait.
        if (!this.modelIdsToBeDisplayed.has(modelId)) {
            this.modelIdsToBeDisplayed.set(modelId, createDeferred());
        }
        // Wait until it is flagged as ready to be processed.
        // This widget manager must have received this message and performed all operations before this.
        // Once all messages prior to this have been processed in sequence and this message is received,
        // then, and only then are we ready to render the widget.
        // I.e. this is a way of synchronizing the render with the processing of the messages.
        await this.modelIdsToBeDisplayed.get(modelId)!.promise;

        const modelPromise = this.manager.get_model(data.model_id);
        if (!modelPromise) {
            console.warn('Widget model not available to render an ipywidget');
            return undefined;
        }

        // ipywdigets may not have completed creating the model.
        // ipywidgets have a promise, as the model may get created by a 3rd party library.
        // That 3rd party library may not be available and may have to be downloaded.
        // Hence the promise to wait until it has been created.
        try {
            // tslint:disable: no-console
            console.log('Render Widget in manager1.ts');
            // await sleep(5_000);
            const model = await modelPromise;
            console.log('Render Widget in manager2.ts');
            const view = await this.manager.create_view(model, { el: ele });
            console.log('Render Widget in manager2.ts');
            // tslint:disable-next-line: no-any
            const widget = await this.manager.display_view(data, view, { node: ele });
            console.log('Finished Render Widget in manager2.ts');
            return widget;
        } catch (ex) {
            // tslint:disable-next-line: no-console
            console.error('Kaboom', ex);
            throw ex;
        }
    }
    private initializeKernelAndWidgetManager(options: KernelSocketOptions) {
        if (this.proxyKernel && fastDeepEqual(options, this.options)) {
            return;
        }
        this.proxyKernel?.dispose(); // NOSONAR
        this.proxyKernel = createKernel(options, this.postOffice, this.pendingMessages);
        this.pendingMessages = [];

        // Dispose any existing managers.
        this.manager?.dispose(); // NOSONAR
        try {
            // The JupyterLabWidgetManager will be exposed in the global variable `window.ipywidgets.main` (check webpack config - src/ipywidgets/webpack.config.js).
            // tslint:disable-next-line: no-any
            const JupyterLabWidgetManagerCtor = (window as any).vscIPyWidgets
                .WidgetManager as IJupyterLabWidgetManagerCtor;
            if (!JupyterLabWidgetManagerCtor) {
                throw new Error('JupyterLabWidgetManadger not defined. Please include/check ipywidgets.js file');
            }
            // Create the real manager and point it at our proxy kernel.
            this.manager = new JupyterLabWidgetManagerCtor(this.proxyKernel, this.widgetContainer, this.scriptLoader);
            //             define('@jupyter-widgets/controls', () => widgets);
            // define('@jupyter-widgets/base', () => base);
            // define('@jupyter-widgets/output', () => outputWidgets);
            // const WIDGET_REGISTRY = [];
            // this.manager.register({
            //     name: '@jupyter-widgets/base',
            //     version: '1.2.0',
            //     exports: {
            //         WidgetModel: base.WidgetModel,
            //         WidgetView: base.WidgetView,
            //         DOMWidgetView: base.DOMWidgetView,
            //         DOMWidgetModel: base.DOMWidgetModel,
            //         LayoutModel: base.LayoutModel,
            //         LayoutView: base.LayoutView,
            //         StyleModel: base.StyleModel,
            //         StyleView: base.StyleView
            //     }
            // });
            // this.manager.register({
            //     name: '@jupyter-widgets/controls',
            //     version: JUPYTER_CONTROLS_VERSION,
            //     exports: widgets as any
            // });
            // this.manager.register({
            //     name: '@jupyter-widgets/output',
            //     version: '1.0.0',
            //     exports: outputWidgets as any
            // });

            // Listen for display data messages so we can prime the model for a display data
            this.proxyKernel.iopubMessage.connect(this.handleDisplayDataMessage.bind(this));

            // Listen for unhandled IO pub so we can forward to the extension
            this.manager.onUnhandledIOPubMessage.connect(this.handleUnhandledIOPubMessage.bind(this));

            // Tell the observable about our new manager
            WidgetManager._instance.next(this);
        } catch (ex) {
            // tslint:disable-next-line: no-console
            console.error('Failed to initialize WidgetManager', ex);
        }
    }
    /**
     * Ensure we create the model for the display data.
     */
    private handleDisplayDataMessage(_sender: any, payload: KernelMessage.IIOPubMessage) {
        // tslint:disable-next-line:no-require-imports
        const jupyterLab = require('@jupyterlab/services') as typeof import('@jupyterlab/services'); // NOSONAR

        if (!jupyterLab.KernelMessage.isDisplayDataMsg(payload)) {
            return;
        }
        const displayMsg = payload as KernelMessage.IDisplayDataMsg;

        if (displayMsg.content && displayMsg.content.data && displayMsg.content.data[WIDGET_MIMETYPE]) {
            // tslint:disable-next-line: no-any
            const data = displayMsg.content.data[WIDGET_MIMETYPE] as any;
            const modelId = data.model_id;
            let deferred = this.modelIdsToBeDisplayed.get(modelId);
            if (!deferred) {
                deferred = createDeferred();
                this.modelIdsToBeDisplayed.set(modelId, deferred);
            }
            if (!this.manager) {
                throw new Error('DS IPyWidgetManager not initialized');
            }
            const modelPromise = this.manager.get_model(data.model_id);
            if (modelPromise) {
                modelPromise.then((_m: any) => deferred?.resolve()).catch((e: any) => deferred?.reject(e));
            } else {
                deferred.resolve();
            }
        }
    }

    private handleUnhandledIOPubMessage(_manager: any, msg: KernelMessage.IIOPubMessage) {
        // Send this to the other side
        if (this.postOffice.onUnhandledKernelMessage) {
            this.postOffice.onUnhandledKernelMessage(msg);
        }
    }
}
