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
        normalizeSelectionForInteractiveWindow: 'interactiveWindow.textEditor.normalizeSelection',
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

    public static readonly fullSettingIds: Record<string, string> = {
        ...this.migratedSettings
    };

    constructor(private readonly jupyterConfig: WorkspaceConfiguration) {}

    public async migrateSettings() {
        const migratedSettings: Thenable<void>[] = [];
        for (let prop of Object.keys(ConfigMigration.migratedSettings)) {
            migratedSettings.push(...this.migrateSetting(prop, ConfigMigration.migratedSettings[prop]));
        }
        try {
            await Promise.all(migratedSettings);
        } catch (e) {
            handleSettingMigrationFailure(e);
        }
    }

    private migrateSetting(oldSetting: string, newSetting: string) {
        const oldDetails = this.jupyterConfig.inspect(oldSetting);
        const newDetails = this.jupyterConfig.inspect(newSetting);

        const migratedSettings: Thenable<void>[] = [];
        if (oldDetails?.workspaceValue !== undefined) {
            let promise: Thenable<void> = Promise.resolve();
            if (newDetails?.workspaceValue === undefined) {
                promise = this.jupyterConfig.update(
                    newSetting,
                    oldDetails.workspaceValue,
                    ConfigurationTarget.Workspace
                );
            }
            migratedSettings.push(
                promise.then(
                    () => this.jupyterConfig.update(oldSetting, undefined, ConfigurationTarget.Workspace),
                    handleSettingMigrationFailure
                )
            );
        }
        if (oldDetails?.workspaceFolderValue !== undefined) {
            let promise: Thenable<void> = Promise.resolve();
            if (newDetails?.workspaceFolderValue === undefined) {
                promise = this.jupyterConfig.update(
                    newSetting,
                    oldDetails.workspaceFolderValue,
                    ConfigurationTarget.WorkspaceFolder
                );
            }
            migratedSettings.push(
                promise.then(
                    () => this.jupyterConfig.update(oldSetting, undefined, ConfigurationTarget.WorkspaceFolder),
                    handleSettingMigrationFailure
                )
            );
        }
        if (oldDetails?.globalValue !== undefined) {
            let promise: Thenable<void> = Promise.resolve();
            if (newDetails?.globalValue === undefined) {
                promise = this.jupyterConfig.update(newSetting, oldDetails.globalValue, ConfigurationTarget.Global);
            }
            migratedSettings.push(
                promise.then(
                    () => this.jupyterConfig.update(oldSetting, undefined, ConfigurationTarget.Global),
                    handleSettingMigrationFailure
                )
            );
        }

        return migratedSettings;
    }
}

function handleSettingMigrationFailure(e: Error) {
    traceWarning('Error migrating Jupyter configuration', e);
}
