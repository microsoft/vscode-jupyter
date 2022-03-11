// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { QuickPickItem } from 'vscode';
import { IApplicationShell } from '../client/common/application/types';
import { PYTHON_LANGUAGE, JVSC_EXTENSION_ID, JVSC_EXTENSION_DisplayName } from '../client/common/constants';
import { DataScience } from '../client/common/utils/localize';
import { INotebookEditorProvider } from '../client/datascience/types';
import { sendTelemetryEvent } from '../client/telemetry';
import { Telemetry } from '../datascience-ui/common/constants';
import { CreationOptionService } from '../kernels/common/creationOptionsService';

@injectable()
export class NotebookCreator {
    constructor(
        @inject(INotebookEditorProvider) private readonly editorProvider: INotebookEditorProvider,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(CreationOptionService) private readonly creationOptionsService: CreationOptionService
    ) {}

    public async createNewNotebook() {
        if (this.creationOptionsService.registrations.length === 0) {
            await this.editorProvider.createNew();
            return;
        }

        const items: (QuickPickItem & {
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
        items.splice(0, 0, {
            defaultCellLanguage: PYTHON_LANGUAGE,
            detail: JVSC_EXTENSION_ID,
            extensionId: JVSC_EXTENSION_ID,
            label: JVSC_EXTENSION_DisplayName
        });
        const placeHolder = DataScience.placeHolderToSelectOptionForNotebookCreation();
        const item = await this.appShell.showQuickPick(items, {
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
