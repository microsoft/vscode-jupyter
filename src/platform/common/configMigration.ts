// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ConfigurationTarget, WorkspaceConfiguration } from 'vscode';
import { traceWarning } from '../logging';
import { noop } from './utils/misc';
import { PYTHON_LANGUAGE } from './constants';

export class ConfigMigration {
    // old setting name: new setting name
    // omit the jupyter. prefix
    public static readonly migratedSettings: Record<string, string> = {
        interactiveWindowMode: 'interactiveWindow.creationMode',
        interactiveWindowViewColumn: 'interactiveWindow.viewColumn',
        splitRunFileIntoCells: 'interactiveWindow.splitRunFileIntoCells',

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
        defaultCellMarker: 'interactiveWindow.cellMarker.default',

        enableExtendedKernelCompletions: 'enableExtendedPythonKernelCompletions'
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
        migratedSettings.push(this.migrateIntellisenseSettings());
        try {
            await Promise.all(migratedSettings);
        } catch (e) {
            handleSettingMigrationFailure(e);
        }
    }

    private async migrateIntellisenseSettings() {
        const oldSetting = 'pythonCompletionTriggerCharacters';
        const newSetting = 'completionTriggerCharacters';
        const oldDetails = this.jupyterConfig.inspect(oldSetting);
        const newDetails = this.jupyterConfig.inspect<Record<string, string[]>>(newSetting);
        try {
            if (oldDetails?.globalValue === oldDetails?.defaultValue || !newDetails) {
                return;
            }
            if (newDetails?.globalValue && newDetails.globalValue[PYTHON_LANGUAGE]) {
                // Already migrated or user already provided a value in the new setting.
                return;
            }
            if (typeof oldDetails?.globalValue === 'string') {
                const newValue = newDetails.globalValue || newDetails.defaultValue || {};
                newValue[PYTHON_LANGUAGE] = oldDetails.globalValue.split('');
                await this.jupyterConfig
                    .update(newSetting, newValue, ConfigurationTarget.Global)
                    .then(noop, handleSettingMigrationFailure);
            }
        } finally {
            // Remove the old setting.
            if (oldDetails?.globalValue) {
                await this.jupyterConfig
                    .update(oldSetting, undefined, ConfigurationTarget.Global)
                    .then(noop, handleSettingMigrationFailure);
            }
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
            if (
                newDetails?.globalValue === undefined &&
                typeof newDetails?.defaultValue !== 'undefined' && // No need to write the new value if its the same as the default.
                oldDetails?.globalValue !== newDetails?.defaultValue
            ) {
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
