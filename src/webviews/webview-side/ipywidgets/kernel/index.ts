// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type * as nbformat from '@jupyterlab/nbformat';
import { KernelMessagingApi, PostOffice } from '../../react-common/postOffice';
import { WidgetManager } from '../common/manager';
import { ScriptManager } from '../common/scriptManager';
import { OutputItem } from 'vscode-notebook-renderer';
import { SharedMessages, IInteractiveWindowMapping, InteractiveWindowMessages } from '../../../../messageTypes';
import { logErrorMessage, logMessage } from '../../react-common/logger';

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
            error: JSON.stringify(data.error)
        });
        console.error(`Failed to to Widget load class ${data.moduleName}${data.className}`, data);
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

const outputDisposables = new Map<string, { dispose(): void }>();
const renderedWidgets = new Map<string, { container: HTMLElement; widget?: { dispose: Function } }>();
/**
 * Called from renderer to render output.
 * This will be exposed as a public method on window for renderer to render output.
 */
let stackOfWidgetsRenderStatusByOutputId: { outputId: string; container: HTMLElement; success?: boolean }[] = [];
export async function renderOutput(
    outputItem: OutputItem,
    model: nbformat.IMimeBundle & {
        model_id: string;
        version_major: number;
        /**
         * This property is only used & added in tests.
         */
        _vsc_test_cellIndex?: number;
    },
    element: HTMLElement,
    logger: (message: string, category?: 'info' | 'error') => void
) {
    try {
        stackOfWidgetsRenderStatusByOutputId.push({ outputId: outputItem.id, container: element });
        renderIPyWidget(outputItem.id, model, element, logger);
    } catch (ex) {
        logger(`Error: render output ${outputItem.id} failed ${ex.toString()}`, 'error');
        console.error(`Failed to render ipywidget type`, ex);
        throw ex;
    }
}
export function disposeOutput(outputId?: string) {
    if (outputId) {
        // We can't delete the widgets because they may be rerendered when we scroll them into view.
        // See issue: https://github.com/microsoft/vscode-jupyter/issues/10485
        // However we can mark them as not being currently rendered.
        stackOfWidgetsRenderStatusByOutputId = stackOfWidgetsRenderStatusByOutputId.filter(
            (item) => !(outputId in item)
        );
    }
}
function renderIPyWidget(
    outputId: string,
    model: nbformat.IMimeBundle & {
        model_id: string;
        version_major: number;
        /**
         * This property is only used & added in tests.
         */
        _vsc_test_cellIndex?: number;
    },
    container: HTMLElement,
    logger: (message: string, category?: 'info' | 'error') => void
) {
    logger(`Rendering IPyWidget ${outputId} with model ${model.model_id}`);
    if (renderedWidgets.has(outputId) && renderedWidgets.get(outputId)?.container === container) {
        return logger('already rendering');
    }
    if (renderedWidgets.has(outputId)) {
        logger('Widget was already rendering for another container, dispose that widget so we can re-render it');
        renderedWidgets.get(outputId)?.widget?.dispose();
    }
    const output = document.createElement('div');
    output.className = 'cell-output cell-output';
    if (typeof model._vsc_test_cellIndex === 'number') {
        container.className += ` vsc-test-cell-index-${model._vsc_test_cellIndex}`;
    }
    const ele = document.createElement('div');
    ele.className = 'cell-output-ipywidget-background';
    container.appendChild(ele);
    ele.appendChild(output);
    renderedWidgets.set(outputId, { container });
    createWidgetView(model, ele)
        .then((w) => {
            if (renderedWidgets.get(outputId)?.container !== container) {
                logger('Widget container changed, hence disposing the widget');
                w?.dispose();
                return;
            }
            if (renderedWidgets.has(outputId)) {
                renderedWidgets.get(outputId)!.widget = w;
            }
            const disposable = {
                dispose: () => {
                    // What if we render the same model in two cells.
                    renderedWidgets.delete(outputId);
                    w?.dispose();
                }
            };
            outputDisposables.set(outputId, disposable);
            // Keep track of the fact that we have successfully rendered a widget for this outputId.
            const statusInfo = stackOfWidgetsRenderStatusByOutputId.find((item) => item.outputId === outputId);
            if (statusInfo) {
                statusInfo.success = true;
            }
        })
        .catch((ex) => {
            logger(`Error: Failed to render ${outputId}, ${ex.toString()}`, 'error');
            console.error('Failed to render', ex);
        });
}

let widgetManagerPromise: Promise<WidgetManager> | undefined;
async function getWidgetManager(): Promise<WidgetManager> {
    if (!widgetManagerPromise) {
        function reInitializeWidgetManager(resolve?: (value: WidgetManager) => void) {
            WidgetManager.instance.subscribe((wm) => {
                if (wm) {
                    const oldDispose = wm.dispose.bind(wm);
                    wm.dispose = () => {
                        // eslint-disable-next-line , @typescript-eslint/no-explicit-any
                        widgetManagerPromise = undefined;
                        return oldDispose();
                    };
                    if (resolve) {
                        resolve(wm);
                        resolve = undefined;
                    }
                    widgetManagerPromise = Promise.resolve(wm);
                }
            });
        }
        // eslint-disable-next-line , @typescript-eslint/no-explicit-any
        widgetManagerPromise = new Promise((resolve) => reInitializeWidgetManager(resolve as any));
    }
    return widgetManagerPromise;
}

async function createWidgetView(
    widgetData: nbformat.IMimeBundle & { model_id: string; version_major: number },
    element: HTMLElement
) {
    try {
        const wm = await getWidgetManager();
        return await wm?.renderWidget(widgetData, element);
    } catch (ex) {
        // eslint-disable-next-line no-console
        console.error(`Failed to render widget ${widgetData.model_id}`, ex);
        logErrorMessage(`Error: Failed to render widget ${widgetData.model_id}, ${ex.toString()}`);
    }
}

function initialize(context?: KernelMessagingApi) {
    try {
        // Setup the widget manager
        const postOffice = new PostOffice(context);
        const mgr = new WidgetManagerComponent(postOffice);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any)._mgr = mgr;
    } catch (ex) {
        // eslint-disable-next-line no-console
        console.error('Exception initializing WidgetManager', ex);
        logErrorMessage(`Error: Exception initializing WidgetManager, ${ex.toString()}`);
    }
}

// Create our window exports
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).ipywidgetsKernel = {
    renderOutput,
    disposeOutput
};

let capturedContext: KernelMessagingApi | undefined;
// To ensure we initialize after the other scripts, wait for them.
function attemptInitialize(context?: KernelMessagingApi) {
    capturedContext = capturedContext || context;
    logMessage(`Attempt Initialize IpyWidgets kernel.js : ${JSON.stringify(context)}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).vscIPyWidgets) {
        logMessage('IPyWidget kernel initializing...');
        initialize(capturedContext);
    } else {
        setTimeout(attemptInitialize, 100);
    }
}

// Has to be this form for VS code to load it correctly
export function activate(context?: KernelMessagingApi) {
    return attemptInitialize(context);
}
