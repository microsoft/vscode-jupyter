// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { anything, instance, mock, verify, when } from 'ts-mockito';
import { ConfigurationChangeEvent, EventEmitter, Uri } from 'vscode';
import { ApplicationShell } from '../../../platform/common/application/applicationShell';
import {
    IApplicationShell,
    IWebviewPanelProvider,
    IWorkspaceService
} from '../../../platform/common/application/types';
import { WebviewPanelProvider } from '../../../platform/webviews/webviewPanelProvider';
import { WorkspaceService } from '../../../platform/common/application/workspace.node';
import { JupyterSettings } from '../../../platform/common/configSettings';
import { ConfigurationService } from '../../../platform/common/configuration/service.node';
import { IConfigurationService, IExtensionContext } from '../../../platform/common/types';
import { IDataScienceErrorHandler } from '../../../kernels/errors/types';
import { DataViewer } from '../../../webviews/extension-side/dataviewer/dataViewer';
import { JupyterVariableDataProvider } from '../../../webviews/extension-side/dataviewer/jupyterVariableDataProvider';
import { IDataViewer, IDataViewerDataProvider } from '../../../webviews/extension-side/dataviewer/types';
import { MockMemento } from '../../mocks/mementos';

suite('DataViewer', () => {
    let dataViewer: IDataViewer;
    let webPanelProvider: IWebviewPanelProvider;
    let configService: IConfigurationService;
    let workspaceService: IWorkspaceService;
    let applicationShell: IApplicationShell;
    let dataProvider: IDataViewerDataProvider;
    const title: string = 'Data Viewer - Title';

    setup(async () => {
        webPanelProvider = mock(WebviewPanelProvider);
        configService = mock(ConfigurationService);
        workspaceService = mock(WorkspaceService);
        applicationShell = mock(ApplicationShell);
        dataProvider = mock(JupyterVariableDataProvider);
        const settings = mock(JupyterSettings);
        const settingsChangedEvent = new EventEmitter<void>();
        const context: IExtensionContext = mock<IExtensionContext>();

        when(settings.onDidChange).thenReturn(settingsChangedEvent.event);
        when(configService.getSettings(anything())).thenReturn(instance(settings));

        const configChangeEvent = new EventEmitter<ConfigurationChangeEvent>();

        when(workspaceService.onDidChangeConfiguration).thenReturn(configChangeEvent.event);
        when(dataProvider.getDataFrameInfo(anything(), anything())).thenResolve({});
        when(context.extensionUri).thenReturn(Uri.parse('/'));

        dataViewer = new DataViewer(
            instance(webPanelProvider),
            instance(configService),
            instance(workspaceService),
            instance(applicationShell),
            new MockMemento(),
            instance(mock<IDataScienceErrorHandler>()),
            instance(context)
        );
    });
    test('Data viewer showData calls gets dataFrame info from data provider', async () => {
        await dataViewer.showData(instance(dataProvider), title);

        verify(dataProvider.getDataFrameInfo(anything(), anything())).once();
    });
    test('Data viewer calls data provider dispose', async () => {
        await dataViewer.showData(instance(dataProvider), title);
        dataViewer.dispose();

        verify(dataProvider.dispose()).once();
    });
});
