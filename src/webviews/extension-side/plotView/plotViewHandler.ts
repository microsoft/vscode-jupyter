// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { NotebookDocument } from 'vscode';

@injectable()
export class PlotViewHandler {
    public async openPlot(notebook: NotebookDocument, _outputId: string) {
        if (notebook.isClosed) {
            return;
        }
    }
}

export function getPngDimensions(buffer: Buffer): { width: number; height: number } {
    // Verify this is a PNG
    if (!isPng(buffer)) {
        throw new Error('The buffer is not a valid png');
    }
    // The dimensions of a PNG are the first 8 bytes (width then height) of the IHDR chunk. The
    // IHDR chunk starts at offset 8.
    return {
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20)
    };
}

function isPng(buffer: Buffer): boolean {
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
