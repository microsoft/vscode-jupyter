// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
/* eslint-disable no-console */
import type { nbformat } from '@jupyterlab/coreutils';
import { NotebookOutputEventParams } from 'vscode-notebook-renderer';
import {
    IInteractiveWindowMapping,
    InteractiveWindowMessages
} from '../../../client/datascience/interactive-common/interactiveWindowTypes';
import { SharedMessages } from '../../../client/datascience/messages';
import { PostOffice } from '../../react-common/postOffice';
import { WidgetManager } from '../common/manager';
import { ScriptManager } from '../common/scriptManager';
class WidgetManagerComponent {
    private readonly widgetManager: WidgetManager;
    private readonly scriptManager: ScriptManager;
    private widgetsCanLoadFromCDN: boolean = false;
    constructor(private postOffice: PostOffice) {
        this.scriptManager = new ScriptManager(postOffice);
        this.scriptManager.onWidgetLoadError(this.handleLoadError.bind(this));
        this.scriptManager.onWidgetLoadSuccess(this.handleLoadSuccess.bind(this));
        this.scriptManager.onWidgetVersionNotSupported(this.handleUnsupportedWidgetVersion.bind(this));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.widgetManager = new WidgetManager(undefined as any, postOffice, this.scriptManager.getScriptLoader());

        postOffice.addHandler({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            handleMessage: (type: string, payload?: any) => {
                if (type === SharedMessages.UpdateSettings) {
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

// eslint-disable-next-line  no-empty,@typescript-eslint/no-empty-function
const noop = () => {};

const outputDisposables = new Map<string, { dispose(): void }>();
const htmlDisposables = new WeakMap<HTMLElement, { dispose(): void }>();
const renderedWidgets = new Set<string>();
/**
 * Called from renderer to render output.
 * This will be exposed as a public method on window for renderer to render output.
 */
let stackOfWidgetsRenderStatusByOutputId: { outputId: string; container: HTMLElement; success?: boolean }[] = [];
export function renderOutput(request: NotebookOutputEventParams) {
    try {
        stackOfWidgetsRenderStatusByOutputId.push({ outputId: request.outputId, container: request.element });
        const output = convertVSCodeOutputToExecutResultOrDisplayData(request);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const model = output.data['application/vnd.jupyter.widget-view+json'] as any;
        if (!model) {
            // eslint-disable-next-line no-console
            return console.error('Nothing to render');
        }
        /* eslint-disable no-console */
        renderIPyWidget(request.outputId, model, request.element);
    } catch (ex) {
        console.error(`Failed to render ipywidget type`, ex);
        throw ex;
    }
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
    if (renderedWidgets.has(outputId)) {
        return console.error('already rendering');
    }
    const output = document.createElement('div');
    output.className = 'cell-output cell-output';
    const ele = document.createElement('div');
    ele.className = 'cell-output-ipywidget-background';
    container.appendChild(ele);
    ele.appendChild(output);
    renderedWidgets.add(outputId);
    createWidgetView(model, ele)
        .then((w) => {
            const disposable = {
                dispose: () => {
                    // What if we render the same model in two cells.
                    renderedWidgets.delete(outputId);
                    w?.dispose();
                }
            };
            outputDisposables.set(outputId, disposable);
            htmlDisposables.set(ele, disposable);
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
        // eslint-disable-next-line , @typescript-eslint/no-explicit-any
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
        // eslint-disable-next-line no-console
        console.error('Failed to render widget', ex);
    }
}

function initialize() {
    try {
        // Setup the widget manager
        const postOffice = new PostOffice();
        const mgr = new WidgetManagerComponent(postOffice);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any)._mgr = mgr;
    } catch (ex) {
        // eslint-disable-next-line no-console
        console.error('Exception initializing WidgetManager', ex);
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

// Create our window exports
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).ipywidgetsKernel = {
    renderOutput,
    disposeOutput
};

// To ensure we initialize after the other scripts, wait for them.
function attemptInitialize() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).vscIPyWidgets) {
        console.log('IPyWidget kernel initializing...');
        initialize();
    } else {
        setTimeout(attemptInitialize, 100);
    }
}
attemptInitialize();
