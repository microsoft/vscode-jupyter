// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Event, extensions, NotebookEditor, window } from 'vscode';
import { IExtensionSingleActivationService } from '../../../activation/types';
import { disposeAllDisposables } from '../../../common/helpers';
import { IDisposable } from '../../../common/types';
import { noop } from '../../../common/utils/misc';
import { PlotSaveHandler } from './plotSaveHandler';
import { PlotViewHandler } from './plotViewHandler';

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
export class RendererCommunication implements IExtensionSingleActivationService, IDisposable {
    private readonly disposables: IDisposable[] = [];
    constructor(
        @inject(PlotSaveHandler) private readonly plotSaveHandler: PlotSaveHandler,
        @inject(PlotViewHandler) private readonly plotViewHandler: PlotViewHandler
    ) {}

    public dispose() {
        disposeAllDisposables(this.disposables);
    }
    public async activate() {
        const ext = extensions.getExtension('ms-toolsai.jupyter-renderers');
        if (!ext) {
            return;
        }
        if (!ext.isActive) {
            await ext.activate();
        }
        const api = ext.exports as {
            onDidReceiveMessage: Event<{ editor: NotebookEditor; message: OpenImageInPlotViewer | SaveImageAs }>;
        };
        api.onDidReceiveMessage(
            ({ editor, message }) => {
                const document = editor.document || window.activeNotebookEditor?.document;
                if (!document) {
                    return;
                }
                if (message.type === 'saveImageAs') {
                    this.plotSaveHandler.savePlot(document, message.outputId, message.mimeType).catch(noop);
                } else if (message.type === 'openImageInPlotViewer') {
                    this.plotViewHandler.openPlot(document, message.outputId).catch(noop);
                }
            },
            this,
            this.disposables
        );
    }
}
