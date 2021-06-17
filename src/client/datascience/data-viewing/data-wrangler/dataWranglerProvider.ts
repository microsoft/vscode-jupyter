import { injectable, inject, named } from 'inversify';
import { noop } from 'lodash';
import {
    CustomDocument,
    Event,
    WebviewPanel,
    Uri,
    CustomDocumentEditEvent,
    EventEmitter,
    window,
    NotebookCell,
    QuickPickOptions,
    ConfigurationTarget,
    ProgressLocation,
    ProgressOptions
} from 'vscode';
import { IExtensionSingleActivationService } from '../../../activation/types';
import { IApplicationShell, ICommandManager, IDataWranglerProvider } from '../../../common/application/types';
import * as uuid from 'uuid/v4';
import { getImportCodeForFileType } from '../../commands/commandRegistry';
import { Commands, Identifiers } from '../../constants';
import { INotebookProvider, IJupyterVariables, INotebookEditor } from '../../types';
import { DataViewerChecker } from '../../interactive-common/dataViewerChecker';
import { IConfigurationService } from '../../../common/types';
import { updateCellCode } from '../../notebook/helpers/executionHelpers';
import {
    IDataWranglerDataProvider,
    IDataWranglerFactory,
    IDataWranglerJupyterVariableDataProviderFactory,
    OpenDataWranglerSetting
} from './types';

@injectable()
export class DataWranglerProvider implements IDataWranglerProvider, IExtensionSingleActivationService {
    public get onDidChangeCustomDocument(): Event<CustomDocumentEditEvent> {
        return this._onDidEdit.event;
    }
    protected readonly _onDidEdit = new EventEmitter<CustomDocumentEditEvent>();

    private dataProviders = new Map<Uri, IDataWranglerDataProvider>();
    private dataViewerChecker: DataViewerChecker;

    constructor(
        @inject(IDataWranglerJupyterVariableDataProviderFactory)
        private readonly dataWranglerJupyterVariableDataProviderFactory: IDataWranglerJupyterVariableDataProviderFactory,
        @inject(IDataWranglerFactory) private readonly dataWranglerFactory: IDataWranglerFactory,
        @inject(INotebookProvider) private notebookProvider: INotebookProvider,
        @inject(IJupyterVariables)
        @named(Identifiers.KERNEL_VARIABLES)
        private kernelVariableProvider: IJupyterVariables,
        @inject(IConfigurationService) private configService: IConfigurationService,
        @inject(IApplicationShell) private appShell: IApplicationShell,
        @inject(ICommandManager) private commandManager: ICommandManager
    ) {
        this.dataViewerChecker = new DataViewerChecker(configService, appShell);
    }

    public async activate() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).registerCustomEditorProvider('jupyter-data-wrangler', this, {
            webviewOptions: {
                retainContextWhenHidden: true
            },
            supportsMultipleEditorsPerDocument: false
        });
    }

    public async open(): Promise<void> {
        const filtersObject: { [name: string]: string[] } = {};
        filtersObject['Data Wrangler'] = ['csv'];

        const uris = await this.appShell.showOpenDialog({
            canSelectMany: false,
            filters: filtersObject
        });

        if (uris && uris.length > 0) {
            await this.importFileAsDataFrameFromContextMenu(uris[0]);
        }
    }

    /**
     * Here our extension is given a resource uri and must return a new CustomDocument
     * for that resource. This is the point at which our extension should create its
     * document internal model for that resource. This may involve reading and parsing
     * the initial resource state from disk or initializing our new CustomDocument.
     */
    public async openCustomDocument(file: Uri): Promise<CustomDocument> {
        await this.initialize(file, 'custom_editor');
        return { uri: file, dispose: noop };
    }

    /**
     * Here our extension must fill in the initial html for the custom editor. If we need,
     * we can also hold onto a reference to the WebviewPanel so that we can reference it
     * later, for example inside commands.
     */
    public async resolveCustomEditor(document: CustomDocument, panel: WebviewPanel) {
        await this.show(document.uri, panel);
    }

    private async importFileAsDataFrameFromContextMenu(file?: Uri) {
        if (file && file.fsPath && file.fsPath.length > 0) {
            await this.initialize(file, 'context_menu');
        }
    }

    private async initialize(file: Uri, source: 'custom_editor' | 'context_menu') {
        let dataCleaningMode = this.configService.getSettings().dataCleaningMode;

        if (dataCleaningMode == '') {
            const qpoptions: QuickPickOptions = {
                ignoreFocusOut: false,
                matchOnDescription: true,
                matchOnDetail: true
            };

            const qpitems = [
                {
                    label: 'Open Just the Data Wrangler',
                    picked: true
                },
                {
                    label: 'Open Data Wrangler With Jupyter Notebook'
                }
            ];

            const selection = await this.appShell.showQuickPick(qpitems, qpoptions);
            switch (selection?.label) {
                case 'Open Just the Data Wrangler':
                    dataCleaningMode = OpenDataWranglerSetting.STANDALONE;
                    await this.configService.updateSetting(
                        'dataCleaningMode',
                        OpenDataWranglerSetting.STANDALONE,
                        undefined,
                        ConfigurationTarget.Global
                    );
                    break;
                case 'Open Data Wrangler With Jupyter Notebook':
                    dataCleaningMode = OpenDataWranglerSetting.WITH_JUPYTER_NOTEBOOK;
                    await this.configService.updateSetting(
                        'dataCleaningMode',
                        OpenDataWranglerSetting.WITH_JUPYTER_NOTEBOOK,
                        undefined,
                        ConfigurationTarget.Global
                    );
                    break;
            }
        }

        let options: ProgressOptions | undefined;
        let setting: OpenDataWranglerSetting | undefined;

        switch (dataCleaningMode) {
            case OpenDataWranglerSetting.STANDALONE: {
                options = {
                    location: ProgressLocation.Notification,
                    cancellable: true,
                    title: 'Importing Data and Launching Data Wrangler...'
                };
                setting = OpenDataWranglerSetting.STANDALONE;

                break;
            }
            case OpenDataWranglerSetting.WITH_JUPYTER_NOTEBOOK: {
                options = {
                    location: ProgressLocation.Notification,
                    cancellable: true,
                    title: 'Importing Data and Launching Data Wrangler with a Jupyter Notebook...'
                };
                setting = OpenDataWranglerSetting.WITH_JUPYTER_NOTEBOOK;

                break;
            }
        }

        if (!options) return;

        await this.appShell.withProgress(options, async (_, __) =>
            this.importAndLaunchDataWrangler(file, setting, source)
        );
    }

    public async importAndLaunchDataWrangler(
        file: Uri,
        setting: OpenDataWranglerSetting | undefined,
        source: 'custom_editor' | 'context_menu'
    ) {
        if (setting == OpenDataWranglerSetting.STANDALONE) {
            const notebook = await this.notebookProvider.getOrCreateNotebook({
                resource: file,
                identity: file,
                disableUI: true
            });
            const code = getImportCodeForFileType(file!.fsPath);
            await notebook?.execute(code, '', 0, uuid(), undefined, true);
            const jupyterVariable = await this.kernelVariableProvider.getFullVariable(
                {
                    name: 'df',
                    value: '',
                    supportsDataExplorer: true,
                    type: 'DataFrame',
                    size: 0,
                    shape: '',
                    count: 0,
                    truncated: true,
                    sourceFile: file?.fsPath
                },
                notebook
            );
            const jupyterVariableDataProvider = await this.dataWranglerJupyterVariableDataProviderFactory.create(
                jupyterVariable
            );
            jupyterVariableDataProvider.setDependencies(jupyterVariable, notebook);
            this.dataProviders.set(file, jupyterVariableDataProvider);
            // May need to resolve custom editor here
            if (source === 'context_menu') {
                await this.show(file, undefined);
            }
        } else if (setting == OpenDataWranglerSetting.WITH_JUPYTER_NOTEBOOK) {
            const notebookEditor: INotebookEditor | undefined = await this.commandManager.executeCommand(
                Commands.CreateNewNotebook
            );
            if (!notebookEditor) {
                return;
            }
            // Add code cell to import dataframe
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const blankCell = (notebookEditor as any).document.cellAt(0) as NotebookCell;
            const code = getImportCodeForFileType(file!.fsPath);
            await updateCellCode(blankCell, code);
            // Run the cells
            await this.commandManager.executeCommand('notebook.cell.execute');
            const jupyterVariable = await this.kernelVariableProvider.getFullVariable(
                {
                    name: 'df',
                    value: '',
                    supportsDataExplorer: true,
                    type: 'DataFrame',
                    size: 0,
                    shape: '',
                    count: 0,
                    truncated: true,
                    sourceFile: file?.fsPath
                },
                notebookEditor.notebook
            );
            const jupyterVariableDataProvider = await this.dataWranglerJupyterVariableDataProviderFactory.create(
                jupyterVariable
            );
            jupyterVariableDataProvider.setDependencies(jupyterVariable, notebookEditor.notebook);
            this.dataProviders.set(file, jupyterVariableDataProvider);
            await this.show(file, undefined);
        }
    }

    private async show(file: Uri, webviewPanel: WebviewPanel | undefined) {
        const jupyterVariableDataProvider = this.dataProviders.get(file);
        if (!jupyterVariableDataProvider) return;
        const dataFrameInfo = await jupyterVariableDataProvider.getDataFrameInfo();
        const columnSize = dataFrameInfo?.columns?.length;
        if (columnSize && (await this.dataViewerChecker.isRequestedColumnSizeAllowed(columnSize))) {
            await this.dataWranglerFactory.create(jupyterVariableDataProvider, 'Data Wrangler', webviewPanel);
        }
    }
}
