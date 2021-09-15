// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import './index.css';
import type { nbformat } from '@jupyterlab/coreutils';
import type { JSONObject } from '@phosphor/coreutils';
import { ActivationFunction, OutputItem, RendererContext } from 'vscode-notebook-renderer';
import { concatMultilineString } from '../common';
import { OpenImageInPlotViewer, SaveImageAs } from '../../client/datascience/notebook/constants';

export const activate: ActivationFunction = (ctx: RendererContext<unknown>) => {
    console.log('Jupyter Notebook Image Renderer activated');
    return {
        renderOutputItem(outputItem: OutputItem, element: HTMLElement) {
            renderOutput(outputItem, element, ctx);
        }
    };
};

function renderOutput(outputItem: OutputItem, element: HTMLElement, ctx: RendererContext<unknown>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mimeString = outputItem.mime || (outputItem as any).mimeType;
    try {
        if (!ctx.workspace.isTrusted && outputItem.mime !== 'image/png' && outputItem.mime !== 'image/jpeg') {
            return;
        }
        console.log('request', outputItem);
        const output = convertVSCodeOutputToExecuteResultOrDisplayData(outputItem);
        console.log(`Rendering mimeType ${mimeString}`, output);
        const mimeBundle = output.data;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        let data: nbformat.MultilineString | JSONObject = mimeBundle[outputItem.mime!];

        // For un-executed output we might get text or svg output as multiline string arrays
        // we want to concat those so we don't display a bunch of weird commas as we expect
        // Single strings in our output
        if (Array.isArray(data)) {
            data = concatMultilineString(data as nbformat.MultilineString, true);
        }

        const customMetadata = output.metadata?.metadata as JSONObject | undefined;
        const needsBackground = customMetadata?.needs_background || 'light';
        const backgroundColor = needsBackground === 'light' ? 'white' : 'black';
        const container = document.createElement('div');
        container.className = 'display';
        container.style.overflow = 'scroll'; // `overflow:scroll` is the default style used by Jupyter lab.

        const savePlotButton = createSaveAsButton(outputItem, ctx);
        const plotViewerButton =
            output.metadata.__displayOpenPlotIcon === true ? createPlotViewerButton(outputItem, ctx) : undefined;
        const onMouseOver = () => {
            if (plotViewerButton) {
                plotViewerButton.className = 'plotIcon';
            }
            savePlotButton.className = 'plotIcon';
        };
        const onMouseOut = () => {
            if (plotViewerButton) {
                plotViewerButton.className = 'plotIcon hidden';
            }
            savePlotButton.className = 'plotIcon hidden';
        };
        savePlotButton.onmouseover = onMouseOver;
        if (plotViewerButton) {
            plotViewerButton.onmouseover = onMouseOver;
        }
        element.appendChild(container);
        container.appendChild(savePlotButton);
        if (plotViewerButton) {
            container.appendChild(plotViewerButton);
        }
        const imgSrc =
            outputItem.mime.toLowerCase().includes('svg') && typeof data === 'string'
                ? undefined
                : URL.createObjectURL(data);
        if (imgSrc) {
            const img = document.createElement('img');
            img.onmouseover = onMouseOver;
            img.onmouseout = onMouseOut;
            img.src = imgSrc;
            img.style.backgroundColor = backgroundColor;
            container.appendChild(img);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const imageMetadata = (customMetadata || {})[outputItem.mime] as Record<string, any> | undefined;
            if (imageMetadata?.height) {
                img.height = imageMetadata.height;
            }
            if (imageMetadata?.width) {
                img.width = imageMetadata.width;
            }
            if (imageMetadata?.unconfined === true) {
                img.style.maxWidth = 'none';
            }
        } else {
            const div = document.createElement('div');
            div.onmouseover = onMouseOver;
            div.onmouseout = onMouseOut;
            div.style.backgroundColor = backgroundColor;
            div.className = 'svgContent';
            div.innerHTML = data as string;
            container.appendChild(div);
        }
    } catch (ex) {
        console.error(`Failed to render mime type ${mimeString}`, ex);
    }
}

function createSaveAsButton(outputItem: OutputItem, ctx: RendererContext<unknown>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const btn = document.createElement('button') as any;
    btn.style.position = 'absolute';
    btn.style.top = '5px';
    btn.style.left = '5px';
    btn.className = 'plotIcon hidden';
    btn.ariaPressed = 'false';
    btn.title = 'Expand image';
    btn.ariaLabel = 'Expand image';
    btn.onclick = () => {
        if (ctx.postMessage) {
            ctx.postMessage(<SaveImageAs>{
                type: 'saveImageAs',
                outputId: outputItem.id,
                mimeType: outputItem.mime
            });
        }
    };
    btn.innerHTML = `<span>
                        <span className="image-button-child">
                            <svg
                                width="16"
                                height="16"
                                viewBox="0 0 16 16"
                                fill="none"
                                xmlns="http://www.w3.org/2000/svg"
                            >
                                <path
                                    class='plotIconSvgPath'
                                    d="M12.0147 2.8595L13.1397 3.9845L13.25 4.25V12.875L12.875 13.25H3.125L2.75 12.875V3.125L3.125 2.75H11.75L12.0147 2.8595ZM3.5 3.5V12.5H12.5V4.406L11.5947 3.5H10.25V6.5H5V3.5H3.5ZM8 3.5V5.75H9.5V3.5H8Z"
                                />
                            </svg>
                        </span>
                    </span>`;
    return btn;
}

function createPlotViewerButton(outputItem: OutputItem, ctx: RendererContext<unknown>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const btn = document.createElement('button') as any;
    btn.style.position = 'absolute';
    btn.style.top = '5px';
    btn.style.left = '45px';
    btn.className = 'plotIcon hidden';
    btn.ariaPressed = 'false';
    btn.title = 'Save As';
    btn.ariaLabel = 'Save As';
    btn.onclick = () => {
        if (ctx.postMessage) {
            ctx.postMessage(<OpenImageInPlotViewer>{
                type: 'openImageInPlotViewer',
                outputId: outputItem.id,
                mimeType: outputItem.mime
            });
        }
    };
    btn.innerHTML = `<span>
                                <span className="image-button-child">
                                    <svg
                                        width="16"
                                        height="16"
                                        viewBox="0 0 16 16"
                                        fill="none"
                                        xmlns="http://www.w3.org/2000/svg"
                                    >
                                        <path
                                            class='plotIconSvgPath'
                                            d="M9.71429 6.28571V12.2857H7.14286V6.28571H9.71429ZM13.1429 2.85714V12.2857H10.5714V2.85714H13.1429ZM2.85714 13.1429H14V14H2V2H2.85714V13.1429ZM6.28571 4.57143V12.2857H3.71429V4.57143H6.28571Z"
                                        />
                                    </svg>
                                </span>
                    </span>`;
    return btn;
}
function convertVSCodeOutputToExecuteResultOrDisplayData(
    outputItem: OutputItem
): nbformat.IExecuteResult | nbformat.IDisplayData {
    const isImage =
        outputItem.mime.toLowerCase().startsWith('image/') && !outputItem.mime.toLowerCase().includes('svg');
    // We add a metadata item `__isJson` to tell us whether the data is of type JSON or not.
    const isJson = (outputItem.metadata as Record<string, unknown>)?.__isJson === true;
    const value = isImage ? outputItem.blob() : isJson ? outputItem.json() : outputItem.text();
    return {
        data: {
            [outputItem.mime]: value
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        metadata: (outputItem.metadata as any) || {},
        execution_count: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        output_type: (outputItem.metadata as any)?.outputType || 'execute_result'
    };
}
