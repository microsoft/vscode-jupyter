// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { anything, instance, mock, verify, when } from 'ts-mockito';
import { ConfigurationChangeEvent, EventEmitter, Uri } from 'vscode';
import { ApplicationShell } from '../../../platform/common/application/applicationShell';
import { IApplicationShell, IWebviewPanelProvider } from '../../../platform/common/application/types';
import { WebviewPanelProvider } from '../../../platform/webviews/webviewPanelProvider';
import { JupyterSettings } from '../../../platform/common/configSettings';
import { ConfigurationService } from '../../../platform/common/configuration/service.node';
import { IConfigurationService, IExtensionContext } from '../../../platform/common/types';
import { IDataScienceErrorHandler } from '../../../kernels/errors/types';
import { DataViewer } from './dataViewer';
import { JupyterVariableDataProvider } from './jupyterVariableDataProvider';
import { IDataViewer, IDataViewerDataProvider } from './types';
import { MockMemento } from '../../../test/mocks/mementos';
import { mockedVSCodeNamespaces } from '../../../test/vscode-mock';

suite('DataViewer', () => {
    let dataViewer: IDataViewer;
    let webPanelProvider: IWebviewPanelProvider;
    let configService: IConfigurationService;
    let applicationShell: IApplicationShell;
    let dataProvider: IDataViewerDataProvider;
    const title: string = 'Data Viewer - Title';

    setup(async () => {
        webPanelProvider = mock(WebviewPanelProvider);
        configService = mock(ConfigurationService);
        applicationShell = mock(ApplicationShell);
        dataProvider = mock(JupyterVariableDataProvider);
        const settings = mock(JupyterSettings);
        const settingsChangedEvent = new EventEmitter<void>();
        const context: IExtensionContext = mock<IExtensionContext>();

        when(settings.onDidChange).thenReturn(settingsChangedEvent.event);
        when(configService.getSettings(anything())).thenReturn(instance(settings));

        const configChangeEvent = new EventEmitter<ConfigurationChangeEvent>();

        when(mockedVSCodeNamespaces.workspace.onDidChangeConfiguration).thenReturn(configChangeEvent.event);
        when(dataProvider.getDataFrameInfo(anything(), anything())).thenResolve({});
        when(context.extensionUri).thenReturn(Uri.parse('/'));

        dataViewer = new DataViewer(
            instance(webPanelProvider),
            instance(configService),
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
