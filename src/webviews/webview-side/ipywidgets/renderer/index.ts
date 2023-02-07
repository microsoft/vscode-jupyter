// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import './styles.css';
import type * as nbformat from '@jupyterlab/nbformat';
import { ActivationFunction, OutputItem, RendererContext } from 'vscode-notebook-renderer';
import { createDeferred, Deferred } from '../../../../platform/common/utils/async';
import { NotebookMetadata } from '../../../../platform/common/utils';
import { logErrorMessage } from '../../react-common/logger';

function convertVSCodeOutputToExecuteResultOrDisplayData(outputItem: OutputItem):
    | (nbformat.IMimeBundle & {
          model_id: string;
          version_major: number;
          /**
           * This property is only used & added in tests.
           */
          _vsc_test_cellIndex?: number;
      })
    | undefined {
    return outputItem.mime.toLowerCase().includes('json') ? outputItem.json() : outputItem.text();
}

/**
 * Error to be throw to to notify VS Code that it should render the output with the next available mime type.
 */
class FallbackRenderer extends Error {
    constructor() {
        super();
        this.name = 'vscode.fallbackToNextRenderer';
    }
}

export const activate: ActivationFunction = (context) => {
    const logger = (message: string, category?: 'info' | 'error') => {
        if (context.postMessage) {
            context.postMessage({
                command: 'log',
                message,
                category
            });
        }
        if (category === 'error') {
            console.error(message);
        }
    };

    logger('Jupyter IPyWidget Renderer Activated');
    hookupTestScripts(context);
    const modelAvailabilityResponse = new Map<string, Deferred<boolean>>();
    const rendererInitPromise = createDeferred<{
        version?: 7 | 8;
        widgetState?: NotebookMetadata['widgets'];
        widgetStateLoaded: boolean;
    }>();
    if (context.postMessage) {
        context.postMessage({ command: 'ipywidget-renderer-loaded' });
    }
    if (context.onDidReceiveMessage) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        context.onDidReceiveMessage(async (e: any) => {
            if (e.command === 'query-widget-state' && e.model_id) {
                modelAvailabilityResponse.get(e.model_id)?.resolve(e.available);
            }
            if (e.command === 'ipywidget-renderer-init') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const ipywidgetsKernel = (window as any).ipywidgetsKernel;
                if (e.version) {
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
                    if (e.version === 7) {
                        unloadWidgets8();
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        (window as any).vscIPyWidgets7.load();
                        logger('Loaded IPYWidgets 7.x', 'info');
                    } else if (e.version === 8) {
                        unloadWidgets7();
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        (window as any).vscIPyWidgets8.load();
                        logger('Loaded IPYWidgets 8.x', 'info');
                    }
                }
                if (e.widgetState && ipywidgetsKernel && e.version) {
                    await ipywidgetsKernel.restoreWidgets(e.widgetState);
                    rendererInitPromise.resolve(Object.assign({}, e, { widgetStateLoaded: true }));
                } else {
                    rendererInitPromise.resolve(Object.assign({}, e, { widgetStateLoaded: false }));
                }
            }
        });
    }
    /**
     * Its possible user has opened a notebook with widget output, in this case
     * the kernel might not be running or the kernel doesn't have the state information
     * for the widget (as this widget could be from a previous session).
     * This function will tell us whether the current kernel has the necessary state required to render this widget.
     */
    async function doesKernelHaveWidgetState(model_id: string): Promise<boolean> {
        if (!context.postMessage) {
            return false;
        }
        const deferred = createDeferred<boolean>();
        modelAvailabilityResponse.set(model_id, deferred);
        context.postMessage({ command: 'query-widget-state', model_id });
        return deferred.promise;
    }
    return {
        async renderOutputItem(outputItem: OutputItem, element: HTMLElement, _signal: AbortController) {
            logger(`Got item for Rendering ${outputItem.id}}`);
            try {
                const renderOutputFunc =
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (window as any).ipywidgetsKernel?.renderOutput || (global as any).ipywidgetsKernel?.renderOutput;
                if (renderOutputFunc) {
                    logger(`Rendering ${outputItem.id} widget renderer found *************`);
                    const widgetModel = convertVSCodeOutputToExecuteResultOrDisplayData(outputItem);
                    if (!widgetModel) {
                        return logger(`Error: Model not found to render output ${outputItem.id}`, 'error');
                    }
                    const info = await rendererInitPromise.promise;
                    if (!info.widgetStateLoaded && !(await doesKernelHaveWidgetState(widgetModel.model_id))) {
                        logger(
                            `Info: Model not found in Kernel state to render output ${outputItem.id}, rendering a fallback mime type`,
                            'info'
                        );
                        throw new FallbackRenderer();
                    }
                    element.className = (element.className || '') + ' cell-output-ipywidget-background';
                    return renderOutputFunc(outputItem, widgetModel, element, logger, doesKernelHaveWidgetState);
                }
                logger(`Error: renderOutputFunc not defined, not rendering output ${outputItem.id}`, 'error');
                throw new FallbackRenderer();
            } catch (ex) {
                logErrorMessage(`Failed to render output ${outputItem.id}, ${ex}`);
                throw ex;
            } finally {
                sendRenderOutputItem(context, outputItem, element);
            }
        },
        disposeOutputItem(id?: string) {
            logger(`Disposing rendered output for ${id}`);
            const disposeOutputFunc =
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (window as any).ipywidgetsKernel?.disposeOutput || (global as any).ipywidgetsKernel?.disposeOutput;
            if (disposeOutputFunc) {
                return disposeOutputFunc(id);
            }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
};

function hookupTestScripts(context: RendererContext<unknown>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyWindow = window as any;
    if (!anyWindow.widgetEntryPoint || typeof anyWindow.widgetEntryPoint.initialize !== 'function') {
        if (context.postMessage) {
            context.postMessage({
                command: 'log',
                message: 'Hook not registered'
            });
        }
        return;
    }
    anyWindow.widgetEntryPoint.initialize(context);
}
function sendRenderOutputItem(context: RendererContext<unknown>, outputItem: OutputItem, element: HTMLElement) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyWindow = window as any;
    if (!anyWindow.widgetEntryPoint || typeof anyWindow.widgetEntryPoint.renderOutputItem !== 'function') {
        return;
    }
    if (context.postMessage) {
        context.postMessage({
            command: 'log',
            message: 'rendering output'
        });
    }
    anyWindow.widgetEntryPoint.renderOutputItem(outputItem, element);
}
