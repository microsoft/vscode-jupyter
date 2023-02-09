// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ConfigurationTarget, WorkspaceConfiguration } from 'vscode';

export class ConfigMigration {
    constructor(private readonly config: WorkspaceConfiguration) {}

    public async migrateSetting(oldSetting: string, newSetting: string) {
        const oldDetails = this.config.inspect(oldSetting);
        const newDetails = this.config.inspect(newSetting);

        if (oldDetails?.workspaceValue) {
            if (newDetails?.workspaceValue) {
                await this.config.update(newSetting, oldDetails.workspaceValue, ConfigurationTarget.Workspace);
            }
            await this.config.update(oldSetting, undefined, ConfigurationTarget.Workspace);
        }
        if (oldDetails?.workspaceFolderValue) {
            if (newDetails?.workspaceFolderValue) {
                await this.config.update(newSetting, oldDetails.workspaceValue, ConfigurationTarget.WorkspaceFolder);
            }
            await this.config.update(oldSetting, undefined, ConfigurationTarget.WorkspaceFolder);
        }
        if (oldDetails?.globalValue) {
            if (newDetails?.globalValue) {
                await this.config.update(newSetting, oldDetails.workspaceValue, ConfigurationTarget.Global);
            }
            await this.config.update(oldSetting, undefined, ConfigurationTarget.Global);
        }
    }
}
