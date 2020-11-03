// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import type { nbformat } from '@jupyterlab/coreutils';
import type { NotebookOutputEventParams } from 'vscode-notebook-renderer';
// import { WidgetManagerComponent } from './container';
import { createEmitter } from './events';
import { createManager, getInstance } from './manager';
// import * as React from 'react';
// import * as ReactDOM from 'react-dom';
import { createDeferred, Deferred } from './misc/async';
import {
    Event,
    IIPyWidgetManager,
    IPyWidgetMessages,
    IPyWidgetsPostOffice,
    IPyWidgetsSettings,
    SharedMessages,
    WidgetScriptSource
} from './types';

// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as isonline from 'is-online';
// import '../../client/common/extensions';
// import { warnAboutWidgetVersionsThatAreNotSupported } from './incompatibleWidgetHandler';
import { registerScripts } from './requirejsRegistry';

type Props = {
    postOffice: IPyWidgetsPostOffice;
    // widgetContainerElement?: string | HTMLElement;
};

class WidgetManagerComponent {
    private readonly widgetManager: IIPyWidgetManager;
    private readonly widgetSourceRequests = new Map<
        string,
        { deferred: Deferred<void>; timer?: NodeJS.Timeout | number }
    >();
    private readonly registeredWidgetSources = new Map<string, WidgetScriptSource>();
    private timedOutWaitingForWidgetsToGetLoaded?: boolean;
    private widgetsCanLoadFromCDN = true; // Temporary.
    private readonly loaderSettings = {
        // Total time to wait for a script to load. This includes ipywidgets making a request to extension for a Uri of a widget,
        // then extension replying back with the Uri (max 5 seconds round trip time).
        // If expires, then Widget downloader will attempt to download with what ever information it has (potentially failing).
        // Note, we might have a message displayed at the user end (asking for consent to use CDN).
        // Hence use 60 seconds.
        timeoutWaitingForScriptToLoad: 60_000,
        // List of widgets that must always be loaded using requirejs instead of using a CDN or the like.
        widgetsRegisteredInRequireJs: new Set<string>(),
        // Callback when loading a widget fails.
        errorHandler: this.handleLoadError.bind(this),
        // Callback when requesting a module be registered with requirejs (if possible).
        loadWidgetScript: this.loadWidgetScript.bind(this),
        successHandler: this.handleLoadSuccess.bind(this)
    };
    constructor(private readonly props: Props) {
        // super(props);
        // const ele =
        //     typeof this.props.widgetContainerElement === 'string'
        //         ? document.getElementById(this.props.widgetContainerElement)
        //         : this.props.widgetContainerElement;
        // this.widgetManager = new WidgetManager(ele, this.props.postOffice, this.loaderSettings);
        this.widgetManager = createManager(null, this.props.postOffice, this.loaderSettings);

        props.postOffice.onDidReceiveKernelMessage((msg) => {
            // tslint:disable-next-line: no-any
            const type = msg.type;
            const payload = msg.payload;
            if (type === SharedMessages.UpdateSettings) {
                // tslint:disable-next-line: no-console
                // console.error('Got Message 1');
                const settings = JSON.parse(payload);
                this.widgetsCanLoadFromCDN = settings.widgetScriptSources.length > 0;
            } else if (
                type === IPyWidgetMessages.IPyWidgets_kernelOptions ||
                type === IPyWidgetMessages.IPyWidgets_onKernelChanged
            ) {
                // tslint:disable-next-line: no-console
                // console.error('Got Message 2');
                // This happens when we have restarted a kernel.
                // If user changed the kernel, then some widgets might exist now and some might now.
                this.widgetSourceRequests.clear();
                this.registeredWidgetSources.clear();
                // } else {
                //     // tslint:disable-next-line: no-console
                //     console.error(`Got unknown Message 2 ${type}`, msg);
            }
        });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public render(): any {
        return null;
    }
    public componentWillUnmount() {
        this.widgetManager.dispose();
    }
    private async handleLoadError(
        className: string,
        moduleName: string,
        moduleVersion: string,
        // tslint:disable-next-line: no-any
        error: any,
        timedout = false
    ) {
        if (!this.props.postOffice.onWidgetLoadFailure) {
            return;
        }
        const isOnline = await isonline.default({ timeout: 1000 });
        this.props.postOffice.onWidgetLoadFailure({
            className,
            moduleName,
            moduleVersion,
            isOnline,
            timedout,
            error,
            cdnsUsed: this.widgetsCanLoadFromCDN
        });
    }
    /**
     * Given a list of the widgets along with the sources, we will need to register them with requirejs.
     * IPyWidgets uses requirejs to dynamically load modules.
     * (https://requirejs.org/docs/api.html)
     * All we're doing here is given a widget (module) name, we register the path where the widget (module) can be loaded from.
     * E.g.
     * requirejs.config({ paths:{
     *  'widget_xyz': '<Url of script without trailing .js>'
     * }});
     */
    private registerScriptSourcesInRequirejs(sources: WidgetScriptSource[]) {
        if (!Array.isArray(sources) || sources.length === 0) {
            return;
        }

        registerScripts(sources);

        // Now resolve promises (anything that was waiting for modules to get registered can carry on).
        sources.forEach((source) => {
            this.registeredWidgetSources.set(source.moduleName, source);
            // We have fetched the script sources for all of these modules.
            // In some cases we might not have the source, meaning we don't have it or couldn't find it.
            let request = this.widgetSourceRequests.get(source.moduleName);
            if (!request) {
                request = {
                    deferred: createDeferred(),
                    timer: undefined
                };
                this.widgetSourceRequests.set(source.moduleName, request);
            }
            request.deferred.resolve();
            if (request.timer !== undefined) {
                // tslint:disable-next-line: no-any
                clearTimeout(request.timer as any); // This is to make this work on Node and Browser
            }
        });
    }
    private registerScriptSourceInRequirejs(source?: WidgetScriptSource) {
        if (!source) {
            return;
        }
        this.registerScriptSourcesInRequirejs([source]);
    }

    /**
     * Method called by ipywidgets to get the source for a widget.
     * When we get a source for the widget, we register it in requriejs.
     * We need to check if it is available on CDN, if not then fallback to local FS.
     * Or check local FS then fall back to CDN (depending on the order defined by the user).
     */
    private loadWidgetScript(moduleName: string, moduleVersion: string): Promise<void> {
        // tslint:disable-next-line: no-console
        console.log(`Fetch IPyWidget source for ${moduleName}`);
        let request = this.widgetSourceRequests.get(moduleName);
        if (request) {
            console.error(`Re-use loading module ${moduleName}`);
        } else {
            console.error(`Start loading module ${moduleName}`);
            request = {
                deferred: createDeferred<void>(),
                timer: undefined
            };

            // If we timeout, then resolve this promise.
            // We don't want the calling code to unnecessary wait for too long.
            // Else UI will not get rendered due to blocking ipywidets (at the end of the day ipywidgets gets loaded via kernel)
            // And kernel blocks the UI from getting processed.
            // Also, if we timeout once, then for subsequent attempts, wait for just 1 second.
            // Possible user has ignored some UI prompt and things are now in a state of limbo.
            // This way things will fall over sooner due to missing widget sources.
            const timeoutTime = this.timedOutWaitingForWidgetsToGetLoaded
                ? 5_000
                : this.loaderSettings.timeoutWaitingForScriptToLoad;

            request.timer = setTimeout(() => {
                if (request && !request.deferred.resolved) {
                    // tslint:disable-next-line: no-console
                    console.error(`Timeout waiting to get widget source for ${moduleName}, ${moduleVersion}`);
                    this.handleLoadError(
                        '<class>',
                        moduleName,
                        moduleVersion,
                        new Error(`Timeout getting source for ${moduleName}:${moduleVersion}`),
                        true
                        // tslint:disable-next-line: no-console
                    ).catch((ex) => console.error('Failed to load in container.tsx', ex));
                    request.deferred.resolve();
                    this.timedOutWaitingForWidgetsToGetLoaded = true;
                }
            }, timeoutTime);

            this.widgetSourceRequests.set(moduleName, request);

            // Whether we have the scripts or not, send message to extension.
            // Useful telemetry and also we know it was explicity requested by ipywidgets.
            this.props.postOffice
                .getWidgetScriptSource({
                    moduleName,
                    moduleVersion
                })
                .then((result) => this.registerScriptSourceInRequirejs(result))
                // tslint:disable-next-line: no-console
                .catch((ex) => console.error(`Failed to fetch scripts for ${moduleName}, ${moduleVersion}`, ex));
        }

        return (
            request.deferred.promise
                .then(() => {
                    // tslint:disable-next-line: no-console
                    console.error(`Attempting to load module ${moduleName}`);
                })
                // tslint:disable-next-line: no-any
                .catch((ex: any) =>
                    // tslint:disable-next-line: no-console
                    console.error(
                        `Failed to load Widget Script from Extension for for ${moduleName}, ${moduleVersion}`,
                        ex
                    )
                )
        );
    }
    private handleLoadSuccess(className: string, moduleName: string, moduleVersion: string) {
        if (!this.props.postOffice.onWidgetLoadSuccess) {
            return;
        }
        this.props.postOffice.onWidgetLoadSuccess({
            className,
            moduleName,
            moduleVersion
        });
    }
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => {};

const outputDisposables = new Map<string, { dispose(): void }>();
const outputDisposables2 = new WeakMap<HTMLElement, { dispose(): void }>();
// window.addEventListener('message', (e) => {
//     // tslint:disable-next-line: no-console
//     // console.error(`Message from backend`, e.data);
//     if (e.data && e.data.type === 'fromKernel') {
//         postToKernel('HelloKernel', 'WorldKernel');
//     }
// });
const renderedWidgets = new Set<string>();
/**
 * Called from renderer to render output.
 * This will be exposed as a public method on window for renderer to render output.
 */
export function renderOutput(request: NotebookOutputEventParams) {
    try {
        // console.error('request', request);
        const output = convertVSCodeOutputToExecutResultOrDisplayData(request);
        // console.log(`Rendering mimeType ${request.mimeType}`, output);
        // console.error('request output', output);

        // tslint:disable-next-line: no-any
        const model = output.data['application/vnd.jupyter.widget-view+json'] as any;
        if (!model) {
            // tslint:disable-next-line: no-console
            return console.error('Nothing to render');
        }
        // tslint:disable: no-console
        renderIPyWidget(request.outputId, model, request.element);
    } catch (ex) {
        console.error(`Failed to render ipywidget type`, ex);
    }

    // postToRendererExtension('Hello', 'World');
    // postToKernel('HelloKernel', 'WorldKernel');
}
function renderIPyWidget(
    outputId: string,
    model: nbformat.IMimeBundle & { model_id: string; version_major: number },
    container: HTMLElement
) {
    // tslint:disable: no-console
    // console.error('Got Something to render');
    if (renderedWidgets.has(model.model_id)) {
        return console.error('already rendering');
    }
    const output = document.createElement('div');
    output.className = 'cell-output cell-output';
    const ele = document.createElement('div');
    ele.className = 'cell-output-ipywidget-background';
    container.appendChild(ele);
    ele.appendChild(output);
    renderedWidgets.add(model.model_id);
    createWidgetView(model, ele)
        .then((w) => {
            const disposable = {
                dispose: () => {
                    renderedWidgets.delete(model.model_id);
                    w?.dispose();
                }
            };
            outputDisposables.set(outputId, disposable);
            outputDisposables2.set(ele, disposable);
        })
        .catch((ex) => console.error('Failed to render', ex));
}

class MyPostOffice implements IPyWidgetsPostOffice {
    public get settings(): IPyWidgetsSettings | undefined {
        return { timeoutWaitingForWidgetsToLoad: 5_000 };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public get onDidReceiveKernelMessage(): Event<any> {
        return this._gotMessage.event;
    }
    private readonly _gotMessage = createEmitter();
    private readonly backendReady = createDeferred();
    private readonly scripts = new Map<string, Deferred<WidgetScriptSource>>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(private readonly api: { postMessage(msg: any): void }) {
        try {
            // For testing, we might use a  browser to load  the stuff.
            // In such instances the `acquireVSCodeApi` will return the event handler to get messages from extension.
            // See ./src/datascience-ui/native-editor/index.html
            window.addEventListener('message', this.onMessage.bind(this));
            // api.onDidReceiveMessage(this.onMessage.bind(this));
        } catch (ex) {
            // Ignore.
            console.error('Oops in ctor of MyPostOffice', ex);
        }

        // window.addEventListener('message', this.onMessage.bind(this));
        // postToKernel('__IPYWIDGET_KERNEL_MESSAGE', { message: IPyWidgetMessages.IPyWidgets_Ready });
    }
    private postToKernel(type: string, payload?: any) {
        this.api.postMessage({ type, payload });
    }

    private onMessage(e: MessageEvent) {
        // console.error(`Got Message in PostOffice`);
        // tslint:disable
        const type: string | undefined = e.data.type ?? e.data.message;
        // console.error(`Got Message in PostOffice type = ${type}`);
        // console.error(`Got Message in PostOffice payload = ${e.data.payload}`);
        if (e.data && type) {
            // tslint:disable-next-line: no-console
            // console.error('processing messages', e.data);
            // tslint:disable-next-line: no-console
            const payload = e.data.payload;
            if (type === IPyWidgetMessages.IPyWidgets_WidgetScriptSourceResponse) {
                // console.error('Got Script source', payload);
                const source: WidgetScriptSource | undefined = payload;
                if (source && this.scripts.has(source.moduleName)) {
                    // console.error('Got Script source and module', payload);
                    this.scripts.get(source.moduleName)?.resolve(source); // NOSONAR
                } else {
                    console.error('Got Script source and module not found', source?.moduleName);
                }
                return;
            } else if (type && type.toUpperCase().startsWith('IPYWIDGET')) {
                // tslint:disable-next-line: no-console
                // console.error(`Message from real backend kernel`, payload);
                this._gotMessage.fire({ type, message: type, payload });
            } else if (type === '__IPYWIDGET_BACKEND_READY') {
                this.backendReady.resolve();
                // } else {
                //     console.error(`No idea what this data is`, e.data);
            }
        }
    }
    // tslint:disable-next-line: no-any
    public postKernelMessage(message: any, payload: any): void {
        console.error(`Message sent ${message}`);
        this.backendReady.promise.then(() => this.postToKernel(message, payload)).catch(noop);
    }
    public async getWidgetScriptSource(options: {
        moduleName: string;
        moduleVersion: string;
    }): Promise<WidgetScriptSource> {
        const deferred = createDeferred<WidgetScriptSource>();
        this.scripts.set(options.moduleName, deferred);
        // Whether we have the scripts or not, send message to extension.
        // Useful telemetry and also we know it was explicity requested by ipywidgets.
        this.postKernelMessage(IPyWidgetMessages.IPyWidgets_WidgetScriptSourceRequest, options);

        return deferred.promise;
    }
    public onReady(): void {
        this.postToKernel(IPyWidgetMessages.IPyWidgets_Ready);
        this.postToKernel('READY');
    }
}

let widgetManagerPromise: Promise<IIPyWidgetManager> | undefined;
async function getWidgetManager(): Promise<IIPyWidgetManager> {
    if (!widgetManagerPromise) {
        widgetManagerPromise = new Promise((resolve) => getInstance().subscribe(resolve));
        widgetManagerPromise
            .then((wm) => {
                if (wm) {
                    const oldDispose = wm.dispose.bind(wm);
                    wm.dispose = () => {
                        // this.renderedViews.clear();
                        // this.widgetManager = undefined;
                        widgetManagerPromise = undefined;
                        return oldDispose();
                    };
                }
            })
            .catch(noop);
    }
    return widgetManagerPromise;
}

async function createWidgetView(
    widgetData: nbformat.IMimeBundle & { model_id: string; version_major: number },
    element: HTMLElement
) {
    const wm = await getWidgetManager();
    try {
        return await wm?.renderWidget(widgetData, element);
    } catch (ex) {
        // tslint:disable-next-line: no-console
        console.error('Failed to render widget', ex);
    }
}

function initialize(api: { postMessage(msg: any): void }) {
    api.postMessage('Loaded');
    try {
        const postOffice: IPyWidgetsPostOffice = new MyPostOffice(api);
        const mgr = new WidgetManagerComponent({ postOffice });
        (window as any)._mgr = mgr;
    } catch (ex) {
        // tslint:disable-next-line: no-console
        console.error('Ooops', ex);
    }
}

function convertVSCodeOutputToExecutResultOrDisplayData(
    request: NotebookOutputEventParams
): nbformat.IExecuteResult | nbformat.IDisplayData {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metadata: Record<string, any> = {};
    // Send metadata only for the mimeType we are interested in.
    const customMetadata = request.output.metadata?.custom;
    if (customMetadata) {
        if (customMetadata[request.mimeType]) {
            metadata[request.mimeType] = customMetadata[request.mimeType];
        }
        if (customMetadata.needs_background) {
            metadata.needs_background = customMetadata.needs_background;
        }
        if (customMetadata.unconfined) {
            metadata.unconfined = customMetadata.unconfined;
        }
    }

    return {
        data: {
            [request.mimeType]: request.output.data[request.mimeType]
        },
        metadata,
        execution_count: null,
        output_type: request.output.metadata?.custom?.vscode?.outputType || 'execute_result'
    };
}

console.log('Loaded Kernel');
export declare function acquireVsCodeApi(): { postMessage(msg: any): void };
const vscodeApi = acquireVsCodeApi();
initialize(vscodeApi);
console.log('Loaded Kernel2');
