// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { QuickPickItem } from 'vscode';
import { IApplicationShell } from '../../../common/application/types';
import { JVSC_EXTENSION_DisplayName, JVSC_EXTENSION_ID, PYTHON_LANGUAGE } from '../../../common/constants';
import { DataScience } from '../../../common/utils/localize';
import { sendTelemetryEvent } from '../../../telemetry';
import { Telemetry, VSCodeNotebookProvider } from '../../constants';
import { INotebookEditorProvider } from '../../types';
import { CreationOptionService } from './creationOptionsService';

@injectable()
export class NotebookCreator {
    constructor(
        @inject(VSCodeNotebookProvider) private readonly editorProvider: INotebookEditorProvider,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(CreationOptionService) private readonly creationOptionsService: CreationOptionService
    ) {}

    public async createNewNotebook() {
        if (this.creationOptionsService.registrations.length === 0) {
            await this.editorProvider.createNew();
            return;
        }

        const options: (QuickPickItem & {
            extensionId: string;
            defaultCellLanguage: string;
        })[] = this.creationOptionsService.registrations.map((item) => {
            return {
                label: item.displayName,
                detail: item.extensionId,
                extensionId: item.extensionId,
                defaultCellLanguage: item.defaultCellLanguage
            };
        });

        // First item is the Jupyter extension.
        options.splice(0, 0, {
            defaultCellLanguage: PYTHON_LANGUAGE,
            detail: JVSC_EXTENSION_ID,
            extensionId: JVSC_EXTENSION_ID,
            label: JVSC_EXTENSION_DisplayName
        });
        const placeHolder = DataScience.placeHolderToSelectOptionForNotebookCreation();
        const item = await this.appShell.showQuickPick(options, {
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder
        });
        sendTelemetryEvent(Telemetry.OpenNotebookSelection, undefined, { extensionId: item?.extensionId });
        if (item) {
            await this.editorProvider.createNew({ defaultCellLanguage: item.defaultCellLanguage });
        }
    }
}
