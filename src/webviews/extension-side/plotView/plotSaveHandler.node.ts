// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { NotebookCellOutput, Uri } from 'vscode';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import { saveSvgToPdf } from '../plotting/plotViewer.node';
import { PlotSaveHandler as PlotSaveHandlerBase, svgMimeType } from './plotSaveHandler';

@injectable()
export class PlotSaveHandler extends PlotSaveHandlerBase {
    constructor(@inject(IFileSystemNode) protected readonly fsNode: IFileSystemNode) {
        super(fsNode);
    }

    protected override async saveAsPdf(output: NotebookCellOutput, target: Uri) {
        const svgXml = Buffer.from(output.items.find((item) => item.mime === svgMimeType)!.data).toString();
        await saveSvgToPdf(svgXml, this.fsNode, target);
    }
}
