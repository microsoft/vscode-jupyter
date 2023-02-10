// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ConfigurationTarget, WorkspaceConfiguration } from 'vscode';
import { traceWarning } from '../logging';

export class ConfigMigration {
    // old setting name: new setting name
    // omit the jupyter. prefix
    public static readonly migratedSettings: Record<string, string> = {
        interactiveWindowMode: 'interactiveWindow.creationMode',
        interactiveWindowViewColumn: 'interactiveWindow.viewColumn',

        sendSelectionToInteractiveWindow: 'interactiveWindow.textEditor.executeSelection',
        magicCommandsAsComments: 'interactiveWindow.textEditor.magicCommandsAsComments',
        enableAutoMoveToNextCell: 'interactiveWindow.textEditor.autoMoveToNextCell',
        newCellOnRunLast: 'interactiveWindow.textEditor.autoAddNewCell',
        pythonCellFolding: 'interactiveWindow.textEditor.cellFolding',

        enableCellCodeLens: 'interactiveWindow.codeLens.enable',
        addGotoCodeLenses: 'interactiveWindow.codeLens.enableGotoCell',
        codeLenses: 'interactiveWindow.codeLens.commands',
        debugCodeLenses: 'interactiveWindow.codeLes.debugCommands',

        codeRegularExpression: 'interactiveWindow.cellMarker.codeRegex',
        markdownRegularExpression: 'interactiveWindow.cellMarker.markdownRegex',
        decorateCells: 'interactiveWindow.cellMarker.decorateCells',
        defaultCellMarker: 'interactiveWindow.cellMarker.default'
    };

    constructor(private readonly jupyterConfig: WorkspaceConfiguration) {}

    public async migrateSettings() {
        for (let prop of Object.keys(ConfigMigration.migratedSettings)) {
            await this.migrateSetting(prop, ConfigMigration.migratedSettings[prop]);
        }
    }

    private async migrateSetting(oldSetting: string, newSetting: string) {
        const oldDetails = this.jupyterConfig.inspect(oldSetting);
        const newDetails = this.jupyterConfig.inspect(newSetting);

        try {
            if (oldDetails?.workspaceValue !== undefined) {
                if (newDetails?.workspaceValue === undefined) {
                    await this.jupyterConfig.update(
                        newSetting,
                        oldDetails.workspaceValue,
                        ConfigurationTarget.Workspace
                    );
                }
                await this.jupyterConfig.update(oldSetting, undefined, ConfigurationTarget.Workspace);
            }
            if (oldDetails?.workspaceFolderValue !== undefined) {
                if (newDetails?.workspaceFolderValue === undefined) {
                    await this.jupyterConfig.update(
                        newSetting,
                        oldDetails.workspaceFolderValue,
                        ConfigurationTarget.WorkspaceFolder
                    );
                }
                await this.jupyterConfig.update(oldSetting, undefined, ConfigurationTarget.WorkspaceFolder);
            }
            if (oldDetails?.globalValue !== undefined) {
                if (newDetails?.globalValue === undefined) {
                    await this.jupyterConfig.update(newSetting, oldDetails.globalValue, ConfigurationTarget.Global);
                }
                await this.jupyterConfig.update(oldSetting, undefined, ConfigurationTarget.Global);
            }
        } catch (e) {
            traceWarning('Error migrating Jupyter configurations', e);
        }
    }
}
