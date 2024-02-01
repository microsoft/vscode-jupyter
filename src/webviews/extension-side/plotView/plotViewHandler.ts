// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { NotebookCellOutputItem, NotebookDocument } from 'vscode';
import { traceError } from '../../../platform/logging';
import { getDisplayPath } from '../../../platform/common/platform/fs-paths';
import { IPlotViewerProvider } from '../plotting/types';
import { uint8ArrayToBase64 } from '../../../platform/common/utils/string';

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
    const imageBuffer = pngOutput.data;
    const imageData = uint8ArrayToBase64(imageBuffer);
    const dims = getPngDimensions(imageBuffer);

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

export function getPngDimensions(buffer: Uint8Array): { width: number; height: number } {
    // Verify this is a PNG
    if (!isPng(buffer)) {
        throw new Error('The buffer is not a valid png');
    }
    // The dimensions of a PNG are the first 8 bytes (width then height) of the IHDR chunk. The
    // IHDR chunk starts at offset 8.
    const view = new DataView(buffer.buffer)
    return {
        width: view.getUint32(16, false),
        height: view.getUint32(20, false)
    };
}

function isPng(buffer: Uint8Array): boolean {
    // The first eight bytes of a PNG datastream always contain the following (decimal) values:
    //   137 80 78 71 13 10 26 10
    return (
        buffer[0] === 137 &&
        buffer[1] === 80 &&
        buffer[2] === 78 &&
        buffer[3] === 71 &&
        buffer[4] === 13 &&
        buffer[5] === 10 &&
        buffer[6] === 26 &&
        buffer[7] === 10 &&
        buffer.length > /*Signature*/ 8 + /*IHDR*/ 21
    );
}
