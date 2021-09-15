// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { notebooks } from 'vscode';
import { IExtensionSyncActivationService } from '../../../activation/types';
import { disposeAllDisposables } from '../../../common/helpers';
import { IDisposable } from '../../../common/types';
import { noop } from '../../../common/utils/misc';
import { JupyterNotebookImageRenderer, OpenImageInPlotViewer, SaveImageAs } from '../constants';
import { PlotSaveHandler } from './plotSaveHandler';
import { PlotViewHandler } from './plotViewHandler';

@injectable()
export class RendererCommunication implements IExtensionSyncActivationService, IDisposable {
    private readonly disposables: IDisposable[] = [];
    constructor(
        @inject(PlotSaveHandler) private readonly plotSaveHandler: PlotSaveHandler,
        @inject(PlotViewHandler) private readonly plotViewHandler: PlotViewHandler
    ) { }

    public dispose() {
        disposeAllDisposables(this.disposables);
    }
    public activate() {
        const api = notebooks.createRendererMessaging(JupyterNotebookImageRenderer);
        api.onDidReceiveMessage(
            ({ editor, message }) => {
                const msg = message as (OpenImageInPlotViewer | SaveImageAs);
                if (msg.type === 'saveImageAs') {
                    this.plotSaveHandler.savePlot(editor, msg.outputId, msg.mimeType).catch(noop);
                } else if (msg.type === 'openImageInPlotViewer') {
                    this.plotViewHandler.openPlot(editor, msg.outputId).catch(noop);
                }
            },
            this,
            this.disposables
        );
    }
}
