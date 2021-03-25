import { assert } from 'chai';
import { anyString, anything, instance, mock, when } from 'ts-mockito';
import { MigrateDataScienceSettingsService } from '../../client/activation/migrateDataScienceSettingsService';
import { ApplicationEnvironment } from '../../client/common/application/applicationEnvironment';
import { IApplicationEnvironment, IWorkspaceService } from '../../client/common/application/types';
import { WorkspaceService } from '../../client/common/application/workspace';
import { PersistentStateFactory, PersistentState } from '../../client/common/persistentState';
import { IPersistentStateFactory } from '../../client/common/types';
import { JupyterServerUriStorage } from '../../client/datascience/jupyter/serverUriStorage';
import { IJupyterServerUriStorage } from '../../client/datascience/types';
import { MockFileSystem } from '../datascience/mockFileSystem';

suite('Migrate data science settings', () => {
    const fs = new MockFileSystem();
    let workspace: IWorkspaceService;
    let application: IApplicationEnvironment;
    let updateDataScienceSettingsService: MigrateDataScienceSettingsService;
    let uriStorage: IJupyterServerUriStorage;
    let persistentStateFactory: IPersistentStateFactory;
    let uriSet: string | undefined = undefined;
    const SETTINGS_FILEPATH = '/path/to/settings.json';
    const originalSettings = `{
    "python.dataScience.allowImportFromNotebook": true,
    "jupyter.allowImportFromNotebook": true,
    "python.dataScience.alwaysTrustNotebooks": true,
    "python.dataScience.enabled": true,
    "python.dataScience.jupyterInterruptTimeout": 0,
    "python.dataScience.jupyterLaunchTimeout": 0,
    "python.dataScience.jupyterLaunchRetries": 0,
    "python.dataScience.jupyterServerURI": "foo",
    "python.dataScience.notebookFileRoot": "foo",
    "python.dataScience.changeDirOnImportExport": true,
    "python.dataScience.useDefaultConfigForJupyter": true,
    "python.dataScience.searchForJupyter": true,
    "python.dataScience.allowInput": true,
    "python.dataScience.showCellInputCode": true,
    "python.dataScience.collapseCellInputCodeByDefault": true,
    "python.dataScience.maxOutputSize": 0,
    "python.dataScience.enableScrollingForCellOutputs": true,
    "python.dataScience.sendSelectionToInteractiveWindow": true,
    "python.dataScience.markdownRegularExpression": "foo",
    "python.dataScience.codeRegularExpression": "foo",
    "python.dataScience.allowLiveShare": true,
    "python.dataScience.errorBackgroundColor": "foo",
    "python.dataScience.ignoreVscodeTheme": true,
    "python.dataScience.variableExplorerExclude": "foo",
    "python.dataScience.liveShareConnectionTimeout": 0,
    "python.dataScience.decorateCells": true,
    "python.dataScience.enableCellCodeLens": true,
    "python.dataScience.askForLargeDataFrames": true,
    "python.dataScience.enableAutoMoveToNextCell": true,
    "python.dataScience.allowUnauthorizedRemoteConnection": true,
    "python.dataScience.askForKernelRestart": true,
    "python.dataScience.enablePlotViewer": true,
    "python.dataScience.codeLenses": "python.dataScience.runcell, python.dataScience.runallcellsabove, python.dataScience.debugcell",
    "python.dataScience.debugCodeLenses": "python.dataScience.debugcontinue, python.dataScience.debugstop, python.dataScience.debugstepover",
    "python.dataScience.debugpyDistPath": "foo",
    "python.dataScience.stopOnFirstLineWhileDebugging": true,
    "python.dataScience.textOutputLimit": 0,
    "python.dataScience.magicCommandsAsComments": true,
    "python.dataScience.stopOnError": true,
    "python.dataScience.remoteDebuggerPort": 0,
    "python.dataScience.colorizeInputBox": true,
    "python.dataScience.addGotoCodeLenses": true,
    "python.dataScience.runMagicCommands": "foo",
    "python.dataScience.runStartupCommands": ["foo", "bar"],
    "python.dataScience.debugJustMyCode": true,
    "python.dataScience.defaultCellMarker": "foo",
    "python.dataScience.verboseLogging": true,
    "python.dataScience.themeMatplotlibPlots": true,
    "python.dataScience.useWebViewServer": true,
    "python.dataScience.variableQueries": ["foo", "bar"],
    "python.dataScience.disableJupyterAutoStart": true,
    "python.dataScience.jupyterCommandLineArguments": ["foo", "bar"],
    "python.dataScience.alwaysScrollOnNewCell": true,
    "python.languageServer": "Pylance",
    "python.linting.enabled": false,
    "python.experiments.optOutFrom": [
        "DeprecatePythonPath - experiment"
    ],
}`;

    const expectedMigratedSettings = `{
    "jupyter.allowImportFromNotebook": true,
    "python.languageServer": "Pylance",
    "python.linting.enabled": false,
    "python.experiments.optOutFrom": [
        "DeprecatePythonPath - experiment"
    ],
    "jupyter.alwaysTrustNotebooks": true,
    "jupyter.enabled": true,
    "jupyter.jupyterInterruptTimeout": 0,
    "jupyter.jupyterLaunchTimeout": 0,
    "jupyter.jupyterLaunchRetries": 0,
    "jupyter.jupyterServerType": "remote",
    "jupyter.notebookFileRoot": "foo",
    "jupyter.changeDirOnImportExport": true,
    "jupyter.useDefaultConfigForJupyter": true,
    "jupyter.searchForJupyter": true,
    "jupyter.allowInput": true,
    "jupyter.showCellInputCode": true,
    "jupyter.collapseCellInputCodeByDefault": true,
    "jupyter.maxOutputSize": 0,
    "jupyter.enableScrollingForCellOutputs": true,
    "jupyter.sendSelectionToInteractiveWindow": true,
    "jupyter.markdownRegularExpression": "foo",
    "jupyter.codeRegularExpression": "foo",
    "jupyter.allowLiveShare": true,
    "jupyter.errorBackgroundColor": "foo",
    "jupyter.ignoreVscodeTheme": true,
    "jupyter.variableExplorerExclude": "foo",
    "jupyter.liveShareConnectionTimeout": 0,
    "jupyter.decorateCells": true,
    "jupyter.enableCellCodeLens": true,
    "jupyter.askForLargeDataFrames": true,
    "jupyter.enableAutoMoveToNextCell": true,
    "jupyter.allowUnauthorizedRemoteConnection": true,
    "jupyter.askForKernelRestart": true,
    "jupyter.enablePlotViewer": true,
    "jupyter.codeLenses": "jupyter.runcell, jupyter.runallcellsabove, jupyter.debugcell",
    "jupyter.debugCodeLenses": "jupyter.debugcontinue, jupyter.debugstop, jupyter.debugstepover",
    "jupyter.debugpyDistPath": "foo",
    "jupyter.stopOnFirstLineWhileDebugging": true,
    "jupyter.textOutputLimit": 0,
    "jupyter.magicCommandsAsComments": true,
    "jupyter.stopOnError": true,
    "jupyter.remoteDebuggerPort": 0,
    "jupyter.colorizeInputBox": true,
    "jupyter.addGotoCodeLenses": true,
    "jupyter.runMagicCommands": "foo",
    "jupyter.runStartupCommands": [
        "foo",
        "bar"
    ],
    "jupyter.debugJustMyCode": true,
    "jupyter.defaultCellMarker": "foo",
    "jupyter.verboseLogging": true,
    "jupyter.themeMatplotlibPlots": true,
    "jupyter.useWebViewServer": true,
    "jupyter.variableQueries": [
        "foo",
        "bar"
    ],
    "jupyter.disableJupyterAutoStart": true,
    "jupyter.jupyterCommandLineArguments": [
        "foo",
        "bar"
    ],
    "jupyter.alwaysScrollOnNewCell": true,
}`;
    const KEYBINDINGS_FILEPATH = '/path/to/keybindings.json';
    const originalKeybindings = `[
    {
        "key": "ctrl+shift+enter",
        "command": "python.datascience.runallcells"
    },
    {
        "key": "ctrl+shift+enter",
        "command": "python.datascience.foo"
    },
    {
        "key": "ctrl+shift+enter",
        "command": "jupyter.foo"
    },
    {
        "key": "ctrl+shift+enter",
        "command": "python.datascience.foobar",
        "when": "python.datascience.hascodecells"
    },
    {
        "key": "ctrl+shift+alt",
        "command": "foo"
    }
]`;
    const expectedMigratedKeybindings = `[
    {
        "key": "ctrl+shift+enter",
        "command": "jupyter.runallcells"
    },
    {
        "key": "ctrl+shift+enter",
        "command": "jupyter.foo"
    },
    {
        "key": "ctrl+shift+enter",
        "command": "jupyter.foobar",
        "when": "jupyter.hascodecells"
    },
    {
        "key": "ctrl+shift+alt",
        "command": "foo"
    }
]`;

    setup(() => {
        fs.addFileContents(SETTINGS_FILEPATH, originalSettings);
        fs.addFileContents(KEYBINDINGS_FILEPATH, originalKeybindings);
        application = mock(ApplicationEnvironment);
        when(application.userCustomKeybindingsFile).thenReturn(KEYBINDINGS_FILEPATH);
        when(application.userSettingsFile).thenReturn(SETTINGS_FILEPATH);
        workspace = mock(WorkspaceService);
        persistentStateFactory = mock(PersistentStateFactory);
        const persistentState = mock(PersistentState);
        when(persistentState.value).thenReturn(false);
        when(persistentState.updateValue(anything())).thenResolve();
        when(persistentStateFactory.createGlobalPersistentState(anything(), anything())).thenReturn(
            instance(persistentState)
        );
        uriStorage = mock(JupyterServerUriStorage);
        when(uriStorage.setUri(anyString())).thenCall((a) => {
            uriSet = a;
            return Promise.resolve();
        });

        updateDataScienceSettingsService = new MigrateDataScienceSettingsService(
            fs,
            instance(application),
            workspace,
            instance(persistentStateFactory),
            instance(uriStorage)
        );
    });
    test('Correctly updates settings and keybindings', async () => {
        await updateDataScienceSettingsService.activate(undefined);
        const actualMigratedSettings = await fs.readLocalFile(SETTINGS_FILEPATH);
        const actualMigratedKeybindings = await fs.readLocalFile(KEYBINDINGS_FILEPATH);
        assert.ok(actualMigratedKeybindings === expectedMigratedKeybindings, 'Failed to migrate custom keybindings');
        assert.ok(actualMigratedSettings === expectedMigratedSettings, 'Failed to migrate python.dataScience settings');
        assert.ok(uriSet === 'foo', 'Uri was not ported');
    });
});
