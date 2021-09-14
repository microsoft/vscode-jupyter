// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { notebooks } from 'vscode';
import { IExtensionSyncActivationService } from '../../../activation/types';
import { disposeAllDisposables } from '../../../common/helpers';
import { IDisposable } from '../../../common/types';
import { noop } from '../../../common/utils/misc';
import { JupyterNotebookImageRenderer } from '../constants';
import { PlotSaveHandler } from './plotSaveHandler';
import { PlotViewHandler } from './plotViewHandler';

@injectable()
export class RendererCommunication implements IExtensionSyncActivationService, IDisposable {
    private readonly disposables: IDisposable[] = [];
    constructor(
        @inject(PlotSaveHandler) private readonly plotSaveHandler: PlotSaveHandler,
        @inject(PlotViewHandler) private readonly plotViewHandler: PlotViewHandler
    ) {}

    public dispose() {
        disposeAllDisposables(this.disposables);
    }
    public activate() {
        const api = notebooks.createRendererMessaging(JupyterNotebookImageRenderer);
        api.onDidReceiveMessage(
            ({ editor, message }) => {
                if (message.type === 'saveAs') {
                    this.plotSaveHandler.savePlot(editor, message.outputId, message.mimeType).catch(noop);
                } else if (message.type === 'openPlot') {
                    this.plotViewHandler.openPlot(editor, message.outputId).catch(noop);
                }
            },
            this,
            this.disposables
        );
    }
}
