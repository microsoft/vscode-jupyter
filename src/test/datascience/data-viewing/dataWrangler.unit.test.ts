// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { anything, instance, mock, verify, when } from 'ts-mockito';
import { ConfigurationChangeEvent, EventEmitter } from 'vscode';
import { ApplicationShell } from '../../../client/common/application/applicationShell';
import { CommandManager } from '../../../client/common/application/commandManager';
import { DocumentManager } from '../../../client/common/application/documentManager';
import { IApplicationShell, IWebviewPanelProvider, IWorkspaceService } from '../../../client/common/application/types';
import { WebviewPanelProvider } from '../../../client/common/application/webviewPanels/webviewPanelProvider';
import { WorkspaceService } from '../../../client/common/application/workspace';
import { JupyterSettings } from '../../../client/common/configSettings';
import { ConfigurationService } from '../../../client/common/configuration/service';
import { IConfigurationService } from '../../../client/common/types';
import { CodeCssGenerator } from '../../../client/datascience/codeCssGenerator';
import { DataWrangler } from '../../../client/datascience/data-viewing/data-wrangler/dataWrangler';
import { IDataWrangler, IDataWranglerDataProvider } from '../../../client/datascience/data-viewing/data-wrangler/types';
import { JupyterVariableDataProvider } from '../../../client/datascience/data-viewing/jupyterVariableDataProvider';
import { JupyterVariableDataProviderFactory } from '../../../client/datascience/data-viewing/jupyterVariableDataProviderFactory';
import { KernelVariables } from '../../../client/datascience/jupyter/kernelVariables';
import { NotebookEditorProvider } from '../../../client/datascience/notebook/notebookEditorProvider';
import { ThemeFinder } from '../../../client/datascience/themeFinder';
import { ICodeCssGenerator, IThemeFinder } from '../../../client/datascience/types';
import { MockMemento } from '../../mocks/mementos';

suite('DataScience - DataWrangler', () => {
    let dataWrangler: IDataWrangler;
    let webPanelProvider: IWebviewPanelProvider;
    let configService: IConfigurationService;
    let codeCssGenerator: ICodeCssGenerator;
    let themeFinder: IThemeFinder;
    let workspaceService: IWorkspaceService;
    let applicationShell: IApplicationShell;
    let dataProvider: IDataWranglerDataProvider;
    let commandManager: CommandManager;
    let jupyterVariables: KernelVariables;
    let dataProviderFactory: JupyterVariableDataProviderFactory;
    let notebookEditorProvider: NotebookEditorProvider;

    const title: string = 'Data Wrangler - Title';

    setup(async () => {
        webPanelProvider = mock(WebviewPanelProvider);
        configService = mock(ConfigurationService);
        codeCssGenerator = mock(CodeCssGenerator);
        themeFinder = mock(ThemeFinder);
        workspaceService = mock(WorkspaceService);
        applicationShell = mock(ApplicationShell);
        dataProvider = mock(JupyterVariableDataProvider);
        commandManager = mock(CommandManager);
        jupyterVariables = mock(KernelVariables);
        dataProviderFactory = mock(JupyterVariableDataProviderFactory);
        notebookEditorProvider = mock(NotebookEditorProvider);
        const documentManager = mock(DocumentManager);
        const settings = mock(JupyterSettings);
        const settingsChangedEvent = new EventEmitter<void>();

        when(settings.onDidChange).thenReturn(settingsChangedEvent.event);
        when(configService.getSettings(anything())).thenReturn(instance(settings));

        const configChangeEvent = new EventEmitter<ConfigurationChangeEvent>();
        when(workspaceService.onDidChangeConfiguration).thenReturn(configChangeEvent.event);

        when(dataProvider.getDataFrameInfo(anything(), anything())).thenResolve({});

        dataWrangler = new DataWrangler(
            instance(webPanelProvider),
            instance(configService),
            instance(codeCssGenerator),
            instance(themeFinder),
            instance(workspaceService),
            instance(applicationShell),
            false,
            new MockMemento(),
            instance(commandManager),
            instance(documentManager),
            instance(jupyterVariables),
            instance(dataProviderFactory),
            instance(notebookEditorProvider)
        );
    });
    test('Data Wrangler showData calls gets dataFrame info from data provider', async () => {
        await dataWrangler.showData(instance(dataProvider), title);

        verify(dataProvider.getDataFrameInfo(anything(), anything())).once();
    });
    test('Data Wrangler calls data provider dispose', async () => {
        await dataWrangler.showData(instance(dataProvider), title);
        dataWrangler.dispose();

        verify(dataProvider.dispose()).once();
    });
});
