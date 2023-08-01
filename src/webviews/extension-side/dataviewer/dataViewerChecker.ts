// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ConfigurationTarget } from 'vscode';
import { IApplicationShell } from '../../../platform/common/application/types';
import { IConfigurationService, Resource } from '../../../platform/common/types';
import { DataScience } from '../../../platform/common/utils/localize';
import { noop } from '../../../platform/common/utils/misc';
import { ColumnWarningSize } from './types';

// This helper class validates requests to show large data in the data viewer and configures related settings.
export class DataViewerChecker {
    constructor(
        private configuration: IConfigurationService,
        private applicationShell: IApplicationShell
    ) {}

    public async isRequestedColumnSizeAllowed(columnSize: number, owningResource?: Resource): Promise<boolean> {
        if (columnSize > ColumnWarningSize && (await this.shouldAskForLargeData(owningResource))) {
            const message = DataScience.tooManyColumnsMessage;
            const yes = DataScience.tooManyColumnsYes;
            const no = DataScience.tooManyColumnsNo;
            const dontAskAgain = DataScience.tooManyColumnsDontAskAgain;

            const result = await this.applicationShell.showWarningMessage(message, yes, no, dontAskAgain);
            if (result === dontAskAgain) {
                await this.disableAskForLargeData();
            }
            return result === yes;
        }
        return true;
    }

    private async shouldAskForLargeData(owningResource?: Resource): Promise<boolean> {
        const settings = owningResource
            ? this.configuration.getSettings(owningResource)
            : this.configuration.getSettings();
        return settings && settings.askForLargeDataFrames === true;
    }

    private async disableAskForLargeData(owningResource?: Resource): Promise<void> {
        const settings = owningResource
            ? this.configuration.getSettings(owningResource)
            : this.configuration.getSettings();
        if (settings) {
            settings.askForLargeDataFrames = false;
            this.configuration
                .updateSetting('askForLargeDataFrames', false, undefined, ConfigurationTarget.Global)
                .catch(noop);
        }
    }
}
