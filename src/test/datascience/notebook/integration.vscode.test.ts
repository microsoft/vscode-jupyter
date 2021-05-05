// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import { Memento, workspace, WorkspaceConfiguration } from 'vscode';
import {
    IVSCodeNotebook,
    IApplicationEnvironment,
    IWorkspaceService,
    ICommandManager
} from '../../../client/common/application/types';
import { UseVSCodeNotebookEditorApi } from '../../../client/common/constants';
import { GLOBAL_MEMENTO, IDisposableRegistry, IMemento } from '../../../client/common/types';
import {
    HAS_EXTENSION_CONFIGURED_CELL_TOOLBAR_SETTING,
    NotebookIntegration
} from '../../../client/datascience/notebook/integration';
import { NotebookCompletionProvider } from '../../../client/datascience/notebook/intellisense/completionProvider';
import { INotebookContentProvider } from '../../../client/datascience/notebook/types';
import { IExtensionTestApi } from '../../common';
import { initialize } from '../../initialize';
import { canRunNotebookTests, closeNotebooksAndCleanUpAfterTests } from './helper';

interface INotebookIntegrationTestAPI {
    moveCellToolbarToLeft(): Promise<void>;
}

suite('VS Code notebook integration', () => {
    let api: IExtensionTestApi;
    let notebookIntegration: INotebookIntegrationTestAPI;
    let notebookConfiguration: WorkspaceConfiguration;

    suiteSetup(async function () {
        if (!(await canRunNotebookTests())) {
            return this.skip();
        }
    });

    setup(async () => {
        api = await initialize();
        const memento = api.serviceManager.get<Memento>(IMemento, GLOBAL_MEMENTO);
        await memento.update(HAS_EXTENSION_CONFIGURED_CELL_TOOLBAR_SETTING, false);
        notebookIntegration = (new NotebookIntegration(
            api.serviceManager.get(IVSCodeNotebook),
            api.serviceManager.get(UseVSCodeNotebookEditorApi),
            api.serviceManager.get(IDisposableRegistry),
            api.serviceManager.get(INotebookContentProvider),
            api.serviceManager.get(IApplicationEnvironment),
            api.serviceManager.get(IWorkspaceService),
            api.serviceManager.get(ICommandManager),
            api.serviceManager.get(NotebookCompletionProvider),
            api.serviceManager.get(IMemento, GLOBAL_MEMENTO)
        ) as unknown) as INotebookIntegrationTestAPI;
        // Delete this setting if it's present
        notebookConfiguration = workspace.getConfiguration('notebook', null);
        await notebookConfiguration.update('cellToolbarLocation', undefined, true);
    });

    teardown(async () => {
        await closeNotebooksAndCleanUpAfterTests();
    });

    suiteTeardown(async () => {
        api = await initialize();
        const memento = api.serviceManager.get<Memento>(IMemento, GLOBAL_MEMENTO);
        await memento.update(HAS_EXTENSION_CONFIGURED_CELL_TOOLBAR_SETTING, false);
        await closeNotebooksAndCleanUpAfterTests();
    });

    test("notebook.cellToolbarLocation hasn't been customized before", async () => {
        // Call activate
        await notebookIntegration.moveCellToolbarToLeft();
        // Verify setting was changed
        notebookConfiguration = workspace.getConfiguration('notebook', null);
        const cellToolbarLocation = notebookConfiguration.get('cellToolbarLocation') as { [key: string]: string };
        const value = cellToolbarLocation!['jupyter-notebook'];
        assert.ok(value === 'left', `Setting was not updated, current value is ${value}`);
    });

    test('User customized notebook.cellToolbarLocation setting, we should honor it', async () => {
        // Customize the setting
        notebookConfiguration = workspace.getConfiguration('notebook', null);
        const cellToolbarLocation = notebookConfiguration.get('cellToolbarLocation') as { [key: string]: string };
        cellToolbarLocation['jupyter-notebook'] = 'hidden';
        await notebookConfiguration.update('cellToolbarLocation', cellToolbarLocation, true);
        // Call activate
        await notebookIntegration.moveCellToolbarToLeft();
        // Verify setting was **not** changed by us as part of activation
        assert.ok(cellToolbarLocation!['jupyter-notebook'] === 'hidden', 'User setting not honored');
    });
});
