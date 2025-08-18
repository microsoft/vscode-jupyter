// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { NotebookCellOutputItem, NotebookDocument } from 'vscode';
import { logger } from '../../../platform/logging';
import { getDisplayPath } from '../../../platform/common/platform/fs-paths';
import { IPlotViewerProvider } from '../plotting/types';
import { uint8ArrayToBase64 } from '../../../platform/common/utils/string';

const svgMimeType = 'image/svg+xml';
const pngMimeType = 'image/png';
const jpegMimeType = 'image/jpeg';
const jpgMimeType = 'image/jpg';
const gifMimeType = 'image/gif';
const webpMimeType = 'image/webp';

const supportedImageMimeTypes = [pngMimeType, jpegMimeType, jpgMimeType, gifMimeType, webpMimeType];

@injectable()
export class PlotViewHandler {
    constructor(@inject(IPlotViewerProvider) private readonly plotViewProvider: IPlotViewerProvider) {}

    public async openPlot(notebook: NotebookDocument, outputId: string) {
        if (notebook.isClosed) {
            return;
        }

        // First try to find SVG
        const outputItem = getOutputItem(notebook, outputId, svgMimeType);
        let svgString: string | undefined;

        if (outputItem) {
            svgString = new TextDecoder().decode(outputItem.data);
        } else {
            // Try to find any supported image format
            let imageOutput: NotebookCellOutputItem | undefined;
            let imageMimeType: string | undefined;

            for (const mimeType of supportedImageMimeTypes) {
                imageOutput = getOutputItem(notebook, outputId, mimeType);
                if (imageOutput) {
                    imageMimeType = mimeType;
                    break;
                }
            }

            if (!imageOutput || !imageMimeType) {
                return logger.error(
                    `No supported image format found to open ${getDisplayPath(notebook.uri)}, id: ${outputId}`
                );
            }

            // Convert the image to SVG for display in plot viewer
            svgString = convertImageToSvg(imageOutput, imageMimeType);
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

// Wrap image data into an SVG element so we can display it in the plot viewer
function convertImageToSvg(imageOutput: NotebookCellOutputItem, mimeType: string): string {
    const imageBuffer = imageOutput.data;
    const imageData = uint8ArrayToBase64(imageBuffer);

    let dims = { width: 800, height: 600 }; // Default dimensions

    // Try to get actual dimensions for PNG images
    if (mimeType === pngMimeType && isPng(imageBuffer)) {
        try {
            dims = getPngDimensions(imageBuffer);
        } catch (e) {
            // Use default dimensions if we can't determine PNG dimensions
            logger.warn('Failed to get PNG dimensions, using defaults', e);
        }
    }

    // Of note here, we want the dims on the SVG element, and the image at 100% this is due to how the SVG control
    // in the plot viewer works. The injected svg is sized down to 100px x 100px on the plot selection list so if
    // dims are set on the image then it scales out of bounds
    return `<?xml version="1.0" encoding="utf-8" standalone="no"?>
<svg height="${dims.height}" width="${dims.width}" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
    <g>
        <image xmlns="http://www.w3.org/2000/svg" x="0" y="0" height="100%" width="100%" xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="data:${mimeType};base64,${imageData}"/>
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
    const view = new DataView(new Uint8Array(buffer).buffer);
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
