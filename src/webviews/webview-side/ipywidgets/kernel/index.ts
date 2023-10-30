// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type * as nbformat from '@jupyterlab/nbformat';
import { KernelMessagingApi, PostOffice } from '../../react-common/postOffice';
import { OutputItem } from 'vscode-notebook-renderer';
import {
    SharedMessages,
    IInteractiveWindowMapping,
    InteractiveWindowMessages,
    IPyWidgetMessages
} from '../../../../messageTypes';
import { logErrorMessage, logMessage } from '../../react-common/logger';
import { WidgetManager } from './manager';
import { ScriptManager } from './scriptManager';
import { IJupyterLabWidgetManagerCtor, INotebookModel } from './types';
import { NotebookMetadata } from '../../../../platform/common/utils';

class WidgetManagerComponent {
    private readonly widgetManager: WidgetManager;
    private readonly scriptManager: ScriptManager;
    private widgetsCanLoadFromCDN: boolean = false;
    constructor(
        private postOffice: PostOffice,
        JupyterLabWidgetManager: IJupyterLabWidgetManagerCtor,
        widgetState?: NotebookMetadata['widgets']
    ) {
        this.scriptManager = new ScriptManager(postOffice);
        this.scriptManager.onWidgetLoadError(this.handleLoadError.bind(this));
        this.scriptManager.onWidgetLoadSuccess(this.handleLoadSuccess.bind(this));
        this.scriptManager.onWidgetVersionNotSupported(this.handleUnsupportedWidgetVersion.bind(this));
        this.widgetManager = new WidgetManager(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            undefined as any,
            postOffice,
            this.scriptManager.getScriptLoader(),
            JupyterLabWidgetManager,
            widgetState
        );

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
const renderedWidgets = new Map<string, { container: HTMLElement; widget?: { dispose: Function }; modelId?: string }>();
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
    logger(`Rendering IPyWidget ${outputId} with model ${model.model_id} in ${container.id}`);
    if (
        renderedWidgets.has(outputId) &&
        renderedWidgets.get(outputId)?.container === container &&
        renderedWidgets.get(outputId)?.modelId === model.model_id
    ) {
        return logger('already rendering');
    }
    let timeout = 0;
    if (renderedWidgets.has(outputId)) {
        // If we're rendering another widget in the same output,
        // then disposing the previous widget and its related state takes a few ms.
        // Unfortunately the `dispose` method in IPYWidgets is sync.
        // Without this, running a cell multiple times with the same widget will result
        // in the widget not getting rendered.
        timeout = 100;
        logger('Widget was already rendering for another container, dispose that widget so we can re-render it');
        try {
            renderedWidgets.get(outputId)?.widget?.dispose();
        } catch {
            //
        }
    }
    if (container.firstChild) {
        try {
            container.removeChild(container.firstChild);
        } catch {
            //
        }
    }
    // See comments in previous section as to why timeout > 0.
    new Promise((resolve) => setTimeout(resolve, timeout))
        .then(() => {
            const output = document.createElement('div');
            output.className = 'cell-output cell-output';
            if (typeof model._vsc_test_cellIndex === 'number') {
                container.className += ` vsc-test-cell-index-${model._vsc_test_cellIndex}`;
            }
            const ele = document.createElement('div');
            ele.className = 'cell-output-ipywidget-background';
            container.appendChild(ele);
            ele.appendChild(output);
            renderedWidgets.set(outputId, { container, modelId: model.model_id });
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
                });
        })
        .catch((ex) => {
            logger(`Error: Failed to render ${outputId}, ${ex.toString()}`, 'error');
        });
}

let widgetManagerPromise: Promise<WidgetManager> | undefined;
async function getWidgetManager(): Promise<WidgetManager> {
    if (!widgetManagerPromise) {
        function reInitializeWidgetManager(resolve?: (value: WidgetManager) => void) {
            function initializeInstance() {
                const wm = WidgetManager.instance;
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
            }
            initializeInstance();
            WidgetManager.onDidChangeInstance(initializeInstance);
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
        logErrorMessage(`Error: Failed to render widget ${widgetData.model_id}, ${ex.toString()}`);
    }
}
/**
 * Provides the ability to restore widget state from ipynb files.
 *
 * @param {NotebookMetadata['widgets']} widgetState
 * @return {*}
 */
async function restoreWidgets(widgetState: NotebookMetadata['widgets']) {
    await new Promise<void>((resolve) => {
        const tryAgain = () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if ((window as any).vscIPyWidgets) {
                return resolve();
            }
            setTimeout(tryAgain, 1_000);
        };
        setTimeout(tryAgain, 1_000);
    });
    try {
        initializeWidgetManager(widgetState);
        const wm = await getWidgetManager();
        const model: INotebookModel = {
            metadata: {
                get: (_: unknown) => {
                    return widgetState!;
                }
            }
        };
        return await wm?.restoreWidgets(model, { loadKernel: false, loadNotebook: true });
    } catch (ex) {
        // eslint-disable-next-line no-console
        logErrorMessage(`Error: Failed to render widget state ${widgetState}, ${ex.toString()}`);
    }
}

let initialized = false;
function initialize(
    JupyterLabWidgetManager: IJupyterLabWidgetManagerCtor,
    context: KernelMessagingApi,
    widgetState?: NotebookMetadata['widgets']
) {
    if (initialized) {
        logErrorMessage(`Error: WidgetManager already initialized`);
        return;
    }
    try {
        // Setup the widget manager
        const postOffice = new PostOffice(context);
        const mgr = new WidgetManagerComponent(postOffice, JupyterLabWidgetManager, widgetState);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any)._mgr = mgr;
        initialized = true;
    } catch (ex) {
        // eslint-disable-next-line no-console
        logErrorMessage(`Error: Exception initializing WidgetManager, ${ex.toString()}`);
    }
}

let capturedContext: KernelMessagingApi;

// Create our window exports
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).ipywidgetsKernel = {
    renderOutput,
    disposeOutput,
    restoreWidgets,
    initialize: () => {
        requestWidgetVersion(capturedContext);
    }
};

function requestWidgetVersion(context: KernelMessagingApi) {
    context.postKernelMessage({ type: IPyWidgetMessages.IPyWidgets_Request_Widget_Version });
}
function initializeWidgetManager(widgetState?: NotebookMetadata['widgets']) {
    logMessage('IPyWidget kernel initializing...');
    // The JupyterLabWidgetManager will be exposed in the global variable `window.ipywidgets.main` (check webpack config - src/ipywidgets/webpack.config.js).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const JupyterLabWidgetManager = (window as any).vscIPyWidgets.WidgetManager as IJupyterLabWidgetManagerCtor;
    if (!JupyterLabWidgetManager) {
        throw new Error('JupyterLabWidgetManager not defined. Please include/check ipywidgets.js file');
    }
    initialize(JupyterLabWidgetManager, capturedContext, widgetState);
}
let ipyWidgetVersionResponseHandled = false;
export function activate(context: KernelMessagingApi) {
    capturedContext = context;
    logMessage(`Attempt Initialize IpyWidgets kernel.js : ${JSON.stringify(context)}`);
    context.onDidReceiveKernelMessage(async (e) => {
        if (
            typeof e === 'object' &&
            e &&
            'type' in e &&
            e.type === IPyWidgetMessages.IPyWidgets_Reply_Widget_Version &&
            'payload' in e &&
            typeof e.payload === 'number'
        ) {
            if (ipyWidgetVersionResponseHandled) {
                return;
            }
            ipyWidgetVersionResponseHandled = true;
            try {
                const version = e.payload;
                logMessage(`Loading IPyWidget Version ${version}`);
                // Load the specific version of the widget scripts
                const widgets7Promise = new Promise<void>((resolve) => {
                    const checkIfLoaded = () => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        if ((window as any).vscIPyWidgets7) {
                            return resolve();
                        }
                        setTimeout(checkIfLoaded, 500);
                    };
                    setTimeout(checkIfLoaded, 500);
                });
                const widgets8Promise = new Promise<void>((resolve) => {
                    const checkIfLoaded = () => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        if ((window as any).vscIPyWidgets8) {
                            return resolve();
                        }
                        setTimeout(checkIfLoaded, 500);
                    };
                    setTimeout(checkIfLoaded, 500);
                });
                await Promise.all([widgets7Promise, widgets8Promise]);
                const unloadWidgets8 = () => {
                    try {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        (window as any).vscIPyWidgets8.unload();
                    } catch {
                        //
                    }
                };
                const unloadWidgets7 = () => {
                    try {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        (window as any).vscIPyWidgets7.unload();
                    } catch {
                        //
                    }
                };
                if (version === 7) {
                    unloadWidgets8();
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (window as any).vscIPyWidgets7.load();
                    logMessage('Loaded IPYWidgets 7.x from Kernel');
                } else if (version === 8) {
                    unloadWidgets7();
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (window as any).vscIPyWidgets8.load();
                    logMessage('Loaded IPYWidgets 8.x from Kernel');
                }

                initializeWidgetManager();
            } catch (ex) {
                logErrorMessage(`Failed to load IPyWidget Version ${e.payload}, ${ex}`);
            }
        }
    });
    requestWidgetVersion(context);
}
