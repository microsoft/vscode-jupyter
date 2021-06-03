// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { QuickPickItem } from 'vscode';
import { IS_CI_SERVER } from '../../../../test/ciConstants';
import { IApplicationShell } from '../../../common/application/types';
import { JVSC_EXTENSION_DisplayName, JVSC_EXTENSION_ID, PYTHON_LANGUAGE } from '../../../common/constants';
import { traceInfoIf } from '../../../common/logger';
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
            console.error('Create using createNew');
            await this.editorProvider.createNew();
            return;
        }
        console.error('Stop 3. this.editorProvider.createNew();');

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
        traceInfoIf(IS_CI_SERVER, `Display quick pick for creation of notebooks ${items.length}`);
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
