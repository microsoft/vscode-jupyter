// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import './styles.css';
import type * as nbformat from '@jupyterlab/nbformat';
import { ActivationFunction, OutputItem, RendererContext } from 'vscode-notebook-renderer';
import { createDeferred, Deferred } from '../../../../platform/common/utils/async';

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

export const activate: ActivationFunction = (context) => {
    const logger = (message: string, category?: 'info' | 'error') => {
        if (context.postMessage) {
            context.postMessage({
                command: 'log',
                message,
                category
            });
        }
    };

    logger('Jupyter IPyWidget Renderer Activated');
    hookupTestScripts(context);
    const modelAvailabilityResponse = new Map<string, Deferred<boolean>>();
    if (context.onDidReceiveMessage) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        context.onDidReceiveMessage((e: any) => {
            if (e.command === 'query-widget-state' && e.model_id) {
                modelAvailabilityResponse.get(e.model_id)?.resolve(e.available);
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
        async renderOutputItem(outputItem: OutputItem, element: HTMLElement, signal: AbortController) {
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
                    if (!(await doesKernelHaveWidgetState(widgetModel.model_id))) {
                        logger(
                            `Info: Model not found in Kernel state to render output ${outputItem.id}, rendering a fallback mime type`,
                            'info'
                        );
                        return renderFallbackMimeType(context, outputItem, element, signal, logger);
                    }
                    element.className = (element.className || '') + ' cell-output-ipywidget-background';
                    return renderOutputFunc(outputItem, widgetModel, element, logger, doesKernelHaveWidgetState);
                }
                // console.error('Rendering widgets on notebook open is not supported.');
                return renderFallbackMimeType(context, outputItem, element, signal, logger);
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
    };
};

type AllOutputContainer = OutputItem & { _allOutputItems: [{ mime: string; getItem: () => Promise<OutputItem> }] };

async function renderFallbackMimeType(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    context: RendererContext<any>,
    outputItem: OutputItem,
    element: HTMLElement,
    signal: AbortController,
    logger: (message: string, category?: 'info' | 'error') => void
) {
    const fallbackEntry = (outputItem as AllOutputContainer)._allOutputItems.find(
        (item) => item.mime !== outputItem.mime
    );
    if (!fallbackEntry) {
        logger(
            `Error: Fallback mime type not found to render output ${outputItem.id}, rendering a fallback mime type`,
            'error'
        );
        return;
    }
    try {
        const [fallbackOutputItem, renderer] = await Promise.all([
            fallbackEntry.getItem(),
            context.getRenderer('vscode.builtin-renderer')
        ]);
        if (!fallbackOutputItem) {
            logger(
                `Error: Output Item of Fallback mime type not found ${outputItem.id}, fallback mime ${fallbackEntry.mime}, rendering a fallback mime type`,
                'error'
            );
            return;
        }
        if (!renderer) {
            logger(
                `Error: Fallback mime for ${outputItem.id} cannot be rendered as built in renderer is not available.`,
                'error'
            );
            return;
        }
        logger(`Info: Rendering fallback mime for ${outputItem.id}, ${fallbackEntry.mime}`, 'error');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (renderer.renderOutputItem as any)(fallbackOutputItem, element, signal);
    } catch (ex) {
        console.error(ex);
    }
}
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
