// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ConfigurationTarget, window } from 'vscode';
import { IConfigurationService, Resource } from '../../../platform/common/types';
import { DataScience } from '../../../platform/common/utils/localize';
import { noop } from '../../../platform/common/utils/misc';
import { ColumnWarningSize } from './types';

// This helper class validates requests to show large data in the data viewer and configures related settings.
export class DataViewerChecker {
    constructor(private configuration: IConfigurationService) {}

    public async isRequestedColumnSizeAllowed(columnSize: number, owningResource?: Resource): Promise<boolean> {
        if (columnSize > ColumnWarningSize && (await this.shouldAskForLargeData(owningResource))) {
            const message = DataScience.tooManyColumnsMessage;
            const yes = DataScience.tooManyColumnsYes;
            const no = DataScience.tooManyColumnsNo;
            const dontAskAgain = DataScience.tooManyColumnsDontAskAgain;

            const result = await window.showWarningMessage(message, yes, no, dontAskAgain);
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
