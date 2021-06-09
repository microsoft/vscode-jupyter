// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { notebooks } from 'vscode';
import { IExtensionSyncActivationService } from '../../../activation/types';
import { UseVSCodeNotebookEditorApi } from '../../../common/constants';
import { disposeAllDisposables } from '../../../common/helpers';
import { IDisposable } from '../../../common/types';
import { noop } from '../../../common/utils/misc';
import { PlotSaveHandler } from './plotSaveHandler';

const rendererId = 'jupyter-notebook-renderer';
type RendererMessageTypes = { type: 'saveAs'; outputId: string; mimeType: string };

@injectable()
export class RendererCommunication implements IExtensionSyncActivationService, IDisposable {
    private readonly disposables: IDisposable[] = [];
    constructor(
        @inject(UseVSCodeNotebookEditorApi) private readonly useVSCNotebook: boolean,
        @inject(PlotSaveHandler) private readonly plotSaveHandler: PlotSaveHandler
    ) {}

    public dispose() {
        disposeAllDisposables(this.disposables);
    }
    public activate() {
        if (!this.useVSCNotebook) {
            return;
        }

        const api = notebooks.createRendererMessaging<unknown, RendererMessageTypes>(rendererId);
        api.onDidReceiveMessage(
            ({ editor, message }) => {
                if (message.type === 'saveAs') {
                    this.plotSaveHandler.savePlot(editor, message.outputId, message.mimeType).catch(noop);
                }
            },
            this,
            this.disposables
        );
    }
}
