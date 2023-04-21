// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { anyString, anything, instance, mock, verify, when } from 'ts-mockito';
import { ConfigurationTarget, WorkspaceConfiguration } from 'vscode';
import { ConfigMigration } from './configMigration';

suite('Configuration Migration tests', () => {
    let jupyterConfig: WorkspaceConfiguration;
    let configMigration: ConfigMigration;

    setup(() => {
        jupyterConfig = mock<WorkspaceConfiguration>();
        configMigration = new ConfigMigration(instance(jupyterConfig));
        when(jupyterConfig.inspect(anyString())).thenCall((settingKey: string) => {
            return { key: settingKey };
        });
        when(jupyterConfig.update(anyString(), anything(), anything())).thenReturn(Promise.resolve());
    });

    test('Nothing to be migrated', async () => {
        await configMigration.migrateSettings();
        verify(jupyterConfig.update(anyString(), anything())).never();
    });

    test('Deprecated workspace setting should be migrated', async () => {
        const oldSetting = 'sendSelectionToInteractiveWindow';
        const newSetting = ConfigMigration.migratedSettings[oldSetting];
        when(jupyterConfig.inspect(oldSetting)).thenReturn({
            key: oldSetting,
            workspaceValue: true
        });

        await configMigration.migrateSettings();

        verify(jupyterConfig.update(anyString(), anything(), anything())).twice();
        verify(jupyterConfig.update(newSetting, true, ConfigurationTarget.Workspace)).once();
        verify(jupyterConfig.update(oldSetting, undefined, ConfigurationTarget.Workspace)).once();
    });

    test('Deprecated workspace setting should be removed, but not overwrite new setting', async () => {
        const oldSetting = 'sendSelectionToInteractiveWindow';
        const newSetting = ConfigMigration.migratedSettings[oldSetting];
        when(jupyterConfig.inspect(oldSetting)).thenReturn({
            key: oldSetting,
            workspaceValue: true
        });
        when(jupyterConfig.inspect(newSetting)).thenReturn({
            key: oldSetting,
            workspaceValue: false
        });

        await configMigration.migrateSettings();

        verify(jupyterConfig.update(anyString(), anything(), anything())).once();
        verify(jupyterConfig.update(oldSetting, undefined, ConfigurationTarget.Workspace)).once();
    });

    test('Deprecated workspace and global settings should both be migrated', async () => {
        const oldSetting = 'interactiveWindowMode';
        const newSetting = ConfigMigration.migratedSettings[oldSetting];
        when(jupyterConfig.inspect(oldSetting)).thenReturn({
            key: oldSetting,
            workspaceValue: 'perfile',
            globalValue: 'single'
        });

        await configMigration.migrateSettings();

        verify(jupyterConfig.update(newSetting, 'perfile', ConfigurationTarget.Workspace)).once();
        verify(jupyterConfig.update(oldSetting, undefined, ConfigurationTarget.Workspace)).once();
        verify(jupyterConfig.update(newSetting, 'single', ConfigurationTarget.Global)).once();
        verify(jupyterConfig.update(oldSetting, undefined, ConfigurationTarget.Global)).once();
    });
});
