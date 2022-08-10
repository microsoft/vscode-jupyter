// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { NotebookCellOutput, Uri } from 'vscode';
import { IApplicationShell, IWorkspaceService } from '../../../platform/common/application/types';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import { saveSvgToPdf } from '../plotting/plotViewer.node';
import { PlotSaveHandler as PlotSaveHandlerBase, svgMimeType } from './plotSaveHandler';

@injectable()
export class PlotSaveHandler extends PlotSaveHandlerBase {
    constructor(
        @inject(IApplicationShell) shell: IApplicationShell,
        @inject(IFileSystemNode) protected readonly fsNode: IFileSystemNode,
        @inject(IWorkspaceService) workspace: IWorkspaceService
    ) {
        super(shell, fsNode, workspace);
    }

    protected override async saveAsPdf(output: NotebookCellOutput, target: Uri) {
        const svgXml = Buffer.from(output.items.find((item) => item.mime === svgMimeType)!.data).toString();
        await saveSvgToPdf(svgXml, this.fsNode, target);
    }
}
