// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { NotebookCellOutput, NotebookDocument, Uri } from 'vscode';
import { traceError } from '../../../platform/logging';
import { IPlotSaveHandler } from './types';

export const svgMimeType = 'image/svg+xml';
export const imageExtensionForMimeType: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpeg',
    'image/gif': 'gif',
    [svgMimeType]: 'svg'
};

@injectable()
export class PlotSaveHandler implements IPlotSaveHandler {
    public async savePlot(notebook: NotebookDocument, _outputId: string, _mimeType: string) {
        if (notebook.isClosed) {
            return;
        }
    }
    protected async saveAsPdf(_output: NotebookCellOutput, _target: Uri) {
        return traceError(`Save as PDF is not yet supported on the web.`);
    }
}
