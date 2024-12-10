// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Event, extensions, NotebookEditor, window } from 'vscode';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { RendererExtension } from '../../../platform/common/constants';
import { dispose } from '../../../platform/common/utils/lifecycle';
import { IDisposable } from '../../../platform/common/types';
import { noop } from '../../../platform/common/utils/misc';
import { PlotViewHandler } from './plotViewHandler';
import { IPlotSaveHandler } from './types';
import { logger } from '../../../platform/logging';
import { DataScience } from '../../../platform/common/utils/localize';

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
export class RendererCommunication implements IExtensionSyncActivationService, IDisposable {
    private readonly disposables: IDisposable[] = [];
    constructor(
        @inject(IPlotSaveHandler) private readonly plotSaveHandler: IPlotSaveHandler,
        @inject(PlotViewHandler) private readonly plotViewHandler: PlotViewHandler
    ) {}

    public dispose() {
        dispose(this.disposables);
    }
    public activate() {
        this.activateImpl().catch(noop);
    }
    public async activateImpl() {
        const ext = extensions.getExtension(RendererExtension);
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
            async ({ editor, message }) => {
                const document = editor.notebook || window.activeNotebookEditor?.notebook;
                if (!document) {
                    return;
                }
                try {
                    if (message.type === 'saveImageAs') {
                        await this.plotSaveHandler.savePlot(document, message.outputId, message.mimeType);
                    } else if (message.type === 'openImageInPlotViewer') {
                        await this.plotViewHandler.openPlot(document, message.outputId);
                    }
                } catch (ex) {
                    logger.error(ex);
                    window.showErrorMessage(DataScience.exportImageFailed(ex.message)).then(noop, noop);
                }
            },
            this,
            this.disposables
        );
    }
}
