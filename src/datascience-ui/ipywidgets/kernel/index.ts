// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
// tslint:disable: no-console
console.log('New Kernel');
import type { nbformat } from '@jupyterlab/coreutils';
import { NotebookOutputEventParams, NotebookRendererApi } from 'vscode-notebook-renderer';
import { SharedMessages } from '../../../client/datascience/messages';
import { PostOffice } from '../../react-common/postOffice';
import { WidgetManager } from '../common/manager';
import { ScriptManager } from '../common/scriptManager';
const JupyterIPyWidgetNotebookRenderer = 'jupyter-ipywidget-renderer';
// import '../../client/common/extensions';
import {
    IInteractiveWindowMapping,
    InteractiveWindowMessages
} from '../../../client/datascience/interactive-common/interactiveWindowTypes';
class WidgetManagerComponent {
    private readonly widgetManager: WidgetManager;
    private readonly scriptManager: ScriptManager;
    private widgetsCanLoadFromCDN: boolean = false;
    constructor(private postOffice: PostOffice) {
        this.scriptManager = new ScriptManager(postOffice);
        this.scriptManager.onWidgetLoadError(this.handleLoadError.bind(this));
        this.scriptManager.onWidgetLoadSuccess(this.handleLoadSuccess.bind(this));
        this.scriptManager.onWidgetVersionNotSupported(this.handleUnsupportedWidgetVersion.bind(this));
        // tslint:disable-next-line: no-any
        this.widgetManager = new WidgetManager(undefined as any, postOffice, this.scriptManager.getScriptLoader());

        postOffice.addHandler({
            // tslint:disable-next-line: no-any
            handleMessage: (type: string, payload?: any) => {
                if (type === SharedMessages.UpdateSettings) {
                    // tslint:disable-next-line: no-console
                    // console.error('Got Message 1');
                    const settings = JSON.parse(payload);
                    this.widgetsCanLoadFromCDN = settings.widgetScriptSources.length > 0;
                }
                return true;
            }
        });
    }
    public dispose() {
        this.widgetManager.dispose();
    }
    private async handleLoadError(data: {
        className: string;
        moduleName: string;
        moduleVersion: string;
        // tslint:disable-next-line: no-any
        error: any;
        timedout?: boolean;
        isOnline: boolean;
    }) {
        this.postOffice.sendMessage<IInteractiveWindowMapping>(InteractiveWindowMessages.IPyWidgetLoadFailure, {
            className: data.className,
            moduleName: data.moduleName,
            moduleVersion: data.moduleVersion,
            cdnsUsed: this.widgetsCanLoadFromCDN,
            isOnline: data.isOnline,
            timedout: data.timedout,
            error: data.error
        });
        renderErrorInLastOutputThatHasNotRendered(data.error);
    }

    private handleUnsupportedWidgetVersion(data: { moduleName: 'qgrid'; moduleVersion: string }) {
        this.postOffice.sendMessage<IInteractiveWindowMapping>(
            InteractiveWindowMessages.IPyWidgetWidgetVersionNotSupported,
            {
                moduleName: data.moduleName,
                moduleVersion: data.moduleVersion
            }
        );
    }

    private handleLoadSuccess(data: { className: string; moduleName: string; moduleVersion: string }) {
        this.postOffice.sendMessage<IInteractiveWindowMapping>(InteractiveWindowMessages.IPyWidgetLoadSuccess, {
            className: data.className,
            moduleName: data.moduleName,
            moduleVersion: data.moduleVersion
        });
    }
}

// tslint:disable-next-line no-empty
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
let stackOfWidgetsRenderStatusByOutputId: { outputId: string; container: HTMLElement; success?: boolean }[] = [];
export function renderOutput(request: NotebookOutputEventParams) {
    console.log('New Kernel2.5');
    try {
        stackOfWidgetsRenderStatusByOutputId.push({ outputId: request.outputId, container: request.element });
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
        console.log('New Kernel3');
        // tslint:disable: no-console
        renderIPyWidget(request.outputId, model, request.element);
    } catch (ex) {
        console.error(`Failed to render ipywidget type`, ex);
        throw ex;
    }

    // postToRendererExtension('Hello', 'World');
    // postToKernel('HelloKernel', 'WorldKernel');
}
export function disposeOutput(e: { outputId: string } | undefined) {
    if (e) {
        stackOfWidgetsRenderStatusByOutputId = stackOfWidgetsRenderStatusByOutputId.filter(
            (item) => !(e.outputId in item)
        );
    }
}
function renderErrorInLastOutputThatHasNotRendered(message: string) {
    const possiblyEmptyOutputElement = [...stackOfWidgetsRenderStatusByOutputId]
        .reverse()
        .find((item) => !item.success);
    if (possiblyEmptyOutputElement) {
        //
        console.log(message);
    }
}
function renderIPyWidget(
    outputId: string,
    model: nbformat.IMimeBundle & { model_id: string; version_major: number },
    container: HTMLElement
) {
    console.log('New Kernel4');
    // tslint:disable: no-console
    // console.error('Got Something to render');
    if (renderedWidgets.has(model.model_id)) {
        return console.error('already rendering');
    }
    console.log('New Kernel5');
    const output = document.createElement('div');
    output.className = 'cell-output cell-output';
    const ele = document.createElement('div');
    ele.className = 'cell-output-ipywidget-background';
    container.appendChild(ele);
    ele.appendChild(output);
    renderedWidgets.add(model.model_id);
    createWidgetView(model, ele)
        .then((w) => {
            console.log('New Kernel6');
            const disposable = {
                dispose: () => {
                    // What if we render the same model in two cells.
                    renderedWidgets.delete(model.model_id);
                    w?.dispose();
                }
            };
            outputDisposables.set(outputId, disposable);
            outputDisposables2.set(ele, disposable);
            // Keep track of the fact that we have successfully rendered a widget for this outputId.
            const statusInfo = stackOfWidgetsRenderStatusByOutputId.find((item) => item.outputId === outputId);
            if (statusInfo) {
                statusInfo.success = true;
            }
        })
        .catch((ex) => console.error('Failed to render', ex));
}

let widgetManagerPromise: Promise<WidgetManager> | undefined;
async function getWidgetManager(): Promise<WidgetManager> {
    if (!widgetManagerPromise) {
        // tslint:disable-next-line: promise-must-complete no-any
        widgetManagerPromise = new Promise((resolve) => WidgetManager.instance.subscribe(resolve as any));
        widgetManagerPromise
            .then((wm) => {
                if (wm) {
                    const oldDispose = wm.dispose.bind(wm);
                    wm.dispose = () => {
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

// tslint:disable-next-line: no-any
function initialize(api: NotebookRendererApi<any>) {
    try {
        // Setup the widget manager
        console.log('New Kernel7');
        const postOffice = new PostOffice();
        const mgr = new WidgetManagerComponent(postOffice);
        // tslint:disable-next-line: no-any
        (window as any)._mgr = mgr;

        // Attach to the renderer if possible
        if (api) {
            console.log('New Kernel8');
            api.onDidCreateOutput(renderOutput);
            api.onWillDestroyOutput(disposeOutput);
        }
    } catch (ex) {
        // tslint:disable-next-line: no-console
        console.error('Ooops', ex);
    }
}

function convertVSCodeOutputToExecutResultOrDisplayData(
    request: NotebookOutputEventParams
): nbformat.IExecuteResult | nbformat.IDisplayData {
    // tslint:disable-next-line: no-any
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

// Create our window exports
// tslint:disable-next-line: no-any
(window as any).ipywidgetsKernel = {
    renderOutput,
    disposeOutput
};

// tslint:disable-next-line: no-suspicious-comment
// This is to workaround bug: https://github.com/microsoft/vscode/issues/110338
function attemptInitialize() {
    // tslint:disable-next-line: no-any
    if ((window as any).vscIPyWidgets) {
        initialize(acquireNotebookRendererApi(JupyterIPyWidgetNotebookRenderer));
    } else {
        setTimeout(attemptInitialize, 100);
    }
}
attemptInitialize();
