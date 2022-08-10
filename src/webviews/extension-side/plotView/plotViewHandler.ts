// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import sizeOf from 'image-size';
import { inject, injectable } from 'inversify';
import { NotebookCellOutputItem, NotebookDocument } from 'vscode';
import { traceError } from '../../../platform/logging';
import { getDisplayPath } from '../../../platform/common/platform/fs-paths';
import { IPlotViewerProvider } from '../plotting/types';

const svgMimeType = 'image/svg+xml';
const pngMimeType = 'image/png';

@injectable()
export class PlotViewHandler {
    constructor(@inject(IPlotViewerProvider) private readonly plotViewProvider: IPlotViewerProvider) {}

    public async openPlot(notebook: NotebookDocument, outputId: string) {
        if (notebook.isClosed) {
            return;
        }
        const outputItem = getOutputItem(notebook, outputId, svgMimeType);
        let svgString: string | undefined;
        if (!outputItem) {
            // Didn't find svg, see if we have png we can convert
            const pngOutput = getOutputItem(notebook, outputId, pngMimeType);

            if (!pngOutput) {
                return traceError(`No SVG or PNG Plot to open ${getDisplayPath(notebook.uri)}, id: ${outputId}`);
            }

            // If we did find a PNG wrap it in an SVG element so that we can display it
            svgString = convertPngToSvg(pngOutput);
        } else {
            svgString = new TextDecoder().decode(outputItem.data);
        }
        if (svgString) {
            await this.plotViewProvider.showPlot(svgString);
        }
    }
}

function getOutputItem(
    notebook: NotebookDocument,
    outputId: string,
    mimeType: string
): NotebookCellOutputItem | undefined {
    for (const cell of notebook.getCells()) {
        for (const output of cell.outputs) {
            if (output.id !== outputId) {
                continue;
            }
            return output.items.find((item) => item.mime === mimeType);
        }
    }
}

// Wrap our PNG data into an SVG element so what we can display it in the current plot viewer
function convertPngToSvg(pngOutput: NotebookCellOutputItem): string {
    const imageBuffer = Buffer.from(pngOutput.data);
    const imageData = imageBuffer.toString('base64');
    const dims = sizeOf(imageBuffer);

    // Of note here, we want the dims on the SVG element, and the image at 100% this is due to how the SVG control
    // in the plot viewer works. The injected svg is sized down to 100px x 100px on the plot selection list so if
    // dims are set on the image then it scales out of bounds
    return `<?xml version="1.0" encoding="utf-8" standalone="no"?>
<svg height="${dims.height}" width="${dims.width}" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
    <g>
        <image xmlns="http://www.w3.org/2000/svg" x="0" y="0" height="100%" width="100%" xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="data:image/png;base64,${imageData}"/>
    </g>
</svg>`;
}
