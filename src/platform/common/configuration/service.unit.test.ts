// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect } from 'chai';
import { ConfigurationTarget, Uri, WorkspaceConfiguration } from 'vscode';
import { JupyterSettings } from '../configSettings';
import { ConfigurationService } from './service.node';
import { instance, mock, verify, when } from 'ts-mockito';
import { mockedVSCodeNamespaces } from '../../../test/vscode-mock';
import { uriEquals } from '../../../test/datascience/helpers';

suite('Configuration Service', () => {
    const resource = Uri.parse('a');
    let configService: ConfigurationService;
    setup(() => {
        when(mockedVSCodeNamespaces.workspace.getWorkspaceFolder(uriEquals(resource))).thenReturn({
            uri: resource,
            index: 0,
            name: '0'
        });
        configService = new ConfigurationService();
    });

    function setupConfigProvider(): WorkspaceConfiguration {
        const workspaceConfig = mock<WorkspaceConfiguration>();
        when(mockedVSCodeNamespaces.workspace.getConfiguration('jupyter', uriEquals(resource))).thenReturn(
            instance(workspaceConfig)
        );
        return workspaceConfig;
    }

    test('Fetching settings goes as expected', () => {
        const settings = configService.getSettings();
        expect(settings).to.be.instanceOf(JupyterSettings);
    });

    test('Do not update global settings if global value is already equal to the new value', async () => {
        const workspaceConfig = setupConfigProvider();
        when(workspaceConfig.inspect('setting')).thenReturn({ globalValue: 'globalValue' } as any);
        when(workspaceConfig.update('setting', 'globalValue', ConfigurationTarget.Global)).thenResolve();

        await configService.updateSetting('setting', 'globalValue', resource, ConfigurationTarget.Global);

        verify(workspaceConfig.update('setting', 'globalValue', ConfigurationTarget.Global)).never();
    });

    test('Update global settings if global value is not equal to the new value', async () => {
        const workspaceConfig = setupConfigProvider();
        when(workspaceConfig.inspect('setting')).thenReturn({ globalValue: 'globalValue' } as any);
        when(workspaceConfig.update('setting', 'newGlobalValue', ConfigurationTarget.Global)).thenResolve();

        await configService.updateSetting('setting', 'newGlobalValue', resource, ConfigurationTarget.Global);

        verify(workspaceConfig.update('setting', 'newGlobalValue', ConfigurationTarget.Global)).once();
    });

    test('Do not update workspace settings if workspace value is already equal to the new value', async () => {
        const workspaceConfig = setupConfigProvider();
        when(workspaceConfig.inspect('setting')).thenReturn({ workspaceValue: 'workspaceValue' } as any);
        when(workspaceConfig.update('setting', 'workspaceValue', ConfigurationTarget.Workspace)).thenReturn();

        await configService.updateSetting('setting', 'workspaceValue', resource, ConfigurationTarget.Workspace);

        verify(workspaceConfig.update('setting', 'workspaceValue', ConfigurationTarget.Workspace)).never();
    });

    test('Update workspace settings if workspace value is not equal to the new value', async () => {
        const workspaceConfig = setupConfigProvider();
        when(workspaceConfig.inspect('setting')).thenReturn({ workspaceValue: 'workspaceValue' } as any);
        when(workspaceConfig.update('setting', 'newWorkspaceValue', ConfigurationTarget.Workspace)).thenResolve();

        await configService.updateSetting('setting', 'newWorkspaceValue', resource, ConfigurationTarget.Workspace);

        verify(workspaceConfig.update('setting', 'newWorkspaceValue', ConfigurationTarget.Workspace)).once();
    });

    test('Do not update workspace folder settings if workspace folder value is already equal to the new value', async () => {
        const workspaceConfig = setupConfigProvider();
        when(workspaceConfig.inspect('setting')).thenReturn({ workspaceFolderValue: 'workspaceFolderValue' } as any);
        when(
            workspaceConfig.update('setting', 'workspaceFolderValue', ConfigurationTarget.WorkspaceFolder)
        ).thenResolve();

        await configService.updateSetting(
            'setting',
            'workspaceFolderValue',
            resource,
            ConfigurationTarget.WorkspaceFolder
        );

        verify(workspaceConfig.update('setting', 'workspaceFolderValue', ConfigurationTarget.WorkspaceFolder)).never();
    });

    test('Update workspace folder settings if workspace folder value is not equal to the new value', async () => {
        const workspaceConfig = setupConfigProvider();
        when(workspaceConfig.inspect('setting')).thenReturn({ workspaceFolderValue: 'workspaceFolderValue' } as any);
        when(
            workspaceConfig.update('setting', 'newWorkspaceFolderValue', ConfigurationTarget.WorkspaceFolder)
        ).thenResolve();

        await configService.updateSetting(
            'setting',
            'newWorkspaceFolderValue',
            resource,
            ConfigurationTarget.WorkspaceFolder
        );

        verify(
            workspaceConfig.update('setting', 'newWorkspaceFolderValue', ConfigurationTarget.WorkspaceFolder)
        ).once();
    });
});
