// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { PlotSaveHandler } from './plotSaveHandler.node';
import { PlotViewHandler } from './plotViewHandler';
import { RendererCommunication as RendererCommunicationBase } from './rendererCommunication';

export type OpenImageInPlotViewer = {
    type: 'openImageInPlotViewer';
    outputId: string;
    mimeType: string;
};
export type SaveImageAs = {
    type: 'saveImageAs';
    outputId: string;
    mimeType: string;
};

@injectable()
export class RendererCommunication extends RendererCommunicationBase {
    constructor(
        @inject(PlotSaveHandler) plotSaveHandler: PlotSaveHandler,
        @inject(PlotViewHandler) plotViewHandler: PlotViewHandler
    ) {
        super(plotSaveHandler, plotViewHandler);
    }
}
