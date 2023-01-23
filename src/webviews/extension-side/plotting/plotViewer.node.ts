// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import '../../../platform/common/extensions';

import { inject, injectable } from 'inversify';
import * as path from '../../../platform/vscode-path/path';
import { Uri } from 'vscode';
import { traceError, traceInfo } from '../../../platform/logging';
import { createDeferred } from '../../../platform/common/utils/async';
import { IExportPlotRequest } from './types';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import * as localize from '../../../platform/common/utils/localize';
import { noop } from '../../../platform/common/utils/misc';
import { PlotViewer as PlotViewerBase } from './plotViewer';
import {
    IApplicationShell,
    IWebviewPanelProvider,
    IWorkspaceService
} from '../../../platform/common/application/types';
import { IConfigurationService, IExtensionContext } from '../../../platform/common/types';

@injectable()
export class PlotViewer extends PlotViewerBase {
    constructor(
        @inject(IWebviewPanelProvider) provider: IWebviewPanelProvider,
        @inject(IConfigurationService) configuration: IConfigurationService,
        @inject(IWorkspaceService) workspaceService: IWorkspaceService,
        @inject(IApplicationShell) applicationShell: IApplicationShell,
        @inject(IFileSystemNode) private fsNode: IFileSystemNode,
        @inject(IExtensionContext) context: IExtensionContext
    ) {
        super(provider, configuration, workspaceService, applicationShell, fsNode, context);
    }

    protected override async exportPlot(payload: IExportPlotRequest): Promise<void> {
        traceInfo('exporting plot...');
        const filtersObject: Record<string, string[]> = {};
        filtersObject[localize.DataScience.pdfFilter] = ['pdf'];
        filtersObject[localize.DataScience.pngFilter] = ['png'];
        filtersObject[localize.DataScience.svgFilter] = ['svg'];

        // Ask the user what file to save to
        const file = await this.applicationShell.showSaveDialog({
            saveLabel: localize.DataScience.exportPlotTitle,
            filters: filtersObject
        });
        try {
            if (file) {
                const ext = path.extname(file.fsPath);
                switch (ext.toLowerCase()) {
                    case '.pdf':
                        await saveSvgToPdf(payload.svg, this.fsNode, file);
                        break;

                    case '.png':
                        const buffer = Buffer.from(payload.png.replace('data:image/png;base64', ''), 'base64');
                        await this.fs.writeFile(file, buffer);
                        break;

                    default:
                    case '.svg':
                        // This is the easy one:
                        await this.fs.writeFile(file, payload.svg);
                        break;
                }
            }
        } catch (e) {
            traceError(e);
            this.applicationShell.showErrorMessage(localize.DataScience.exportImageFailed(e)).then(noop, noop);
        }
    }
}

export async function saveSvgToPdf(svg: string, fs: IFileSystemNode, file: Uri) {
    traceInfo('Attempting pdf write...');
    // Import here since pdfkit is so huge.
    const SVGtoPDF = (await import('svg-to-pdfkit')).default;
    const deferred = createDeferred<void>();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfkit = require('pdfkit/js/pdfkit.standalone') as typeof import('pdfkit');
    const doc = new pdfkit();
    const ws = fs.createLocalWriteStream(file.fsPath);
    traceInfo(`Writing pdf to ${file.fsPath}`);
    ws.on('finish', () => deferred.resolve);
    // See docs or demo from source https://cdn.statically.io/gh/alafr/SVG-to-PDFKit/master/examples/demo.htm
    // How to resize to fit (fit within the height & width of page).
    SVGtoPDF(doc, svg, 0, 0, { preserveAspectRatio: 'xMinYMin meet' });
    doc.pipe(ws);
    doc.end();
    traceInfo(`Finishing pdf to ${file.fsPath}`);
    await deferred.promise;
    traceInfo(`Completed pdf to ${file.fsPath}`);
}
