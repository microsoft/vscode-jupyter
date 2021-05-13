import { injectable, inject, named } from 'inversify';
import { noop } from 'lodash';
import { CustomDocument, Event, WebviewPanel, Uri, CustomDocumentEditEvent, EventEmitter, window, NotebookCell, QuickPickOptions, ConfigurationTarget, ProgressLocation, ProgressOptions } from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { IApplicationShell, ICommandManager, IDataWranglerProvider } from '../../common/application/types';
import * as uuid from 'uuid/v4';
import { getImportCodeForFileType } from '../commands/commandRegistry';
import { Commands, Identifiers } from '../constants';
import { IJupyterVariableDataProviderFactory, INotebookProvider, IJupyterVariables, INotebookEditor } from '../types';
import { IDataViewerDataProvider, IDataViewerFactory } from './types';
import { DataViewerChecker } from '../interactive-common/dataViewerChecker';
import { IConfigurationService } from '../../common/types';
import { updateCellCode } from '../notebook/helpers/executionHelpers';


enum OpenDataViewerSetting {
    STANDALONE,
    WITH_JUPYTER_NOTEBOOK,
    WITH_PYTHON_FILE,
    WITH_INTERACTIVE_WINDOW
}

@injectable()
export class DataWranglerProvider implements IDataWranglerProvider, IExtensionSingleActivationService {
    public get onDidChangeCustomDocument(): Event<CustomDocumentEditEvent> {
        return this._onDidEdit.event;
    }
    protected readonly _onDidEdit = new EventEmitter<CustomDocumentEditEvent>();

    private dataProviders = new Map<Uri, IDataViewerDataProvider>();
    private dataViewerChecker: DataViewerChecker;

    constructor(
        @inject(IJupyterVariableDataProviderFactory)
        private readonly jupyterVariableDataProviderFactory: IJupyterVariableDataProviderFactory,
        @inject(IDataViewerFactory) private readonly dataViewerFactory: IDataViewerFactory,
        @inject(INotebookProvider) private notebookProvider: INotebookProvider,
        @inject(IJupyterVariables)
        @named(Identifiers.KERNEL_VARIABLES)
        private kernelVariableProvider: IJupyterVariables,
        @inject(IConfigurationService) private configService: IConfigurationService,
        @inject(IApplicationShell) private appShell: IApplicationShell,
        @inject(ICommandManager) private commandManager: ICommandManager
    ) {
        this.commandManager.registerCommand(Commands.ImportAsDataFrame, this.importFileAsDataFrameFromContextMenu.bind(this));
        this.dataViewerChecker = new DataViewerChecker(configService, appShell);
    }

    public async activate() {
        (window as any).registerCustomEditorProvider('jupyter-data-wrangler', this, {
            webviewOptions: {
                retainContextWhenHidden: true
            },
            supportsMultipleEditorsPerDocument: false
        });
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

    private async initialize(file: Uri, source: 'custom_editor' | 'context_menu' ) {
        let dataCleaningMode = this.configService.getSettings().dataCleaningMode;

        if (dataCleaningMode == '') {
            const qpoptions: QuickPickOptions = {
                ignoreFocusOut: false,
                matchOnDescription: true,
                matchOnDetail: true
            };

            const qpitems = [
                {
                    label: 'Open just the Data Viewer',
                    picked: true
                },
                {
                    label: 'Open with Jupyter Notebook'
                }
            ];

            const selection = await this.appShell.showQuickPick(qpitems, qpoptions);
            switch (selection?.label) {
                case 'Open just the Data Viewer':
                    dataCleaningMode = 'standalone';
                    await this.configService.updateSetting(
                        'dataCleaningMode',
                        'standalone',
                        undefined,
                        ConfigurationTarget.Global
                    );
                    break;
                case 'Open with Jupyter Notebook':
                    dataCleaningMode = 'jupyter_notebook';
                    await this.configService.updateSetting(
                        'dataCleaningMode',
                        'jupyter_notebook',
                        undefined,
                        ConfigurationTarget.Global
                    );
                    break;
                case 'Open with Python file':
                    dataCleaningMode = 'python_file';
                    await this.configService.updateSetting(
                        'dataCleaningMode',
                        'python_file',
                        undefined,
                        ConfigurationTarget.Global
                    );
                    break;
                case 'Open with an Interactive Python session':
                    dataCleaningMode = 'interactive_window';
                    await this.configService.updateSetting(
                        'dataCleaningMode',
                        'interactive_window',
                        undefined,
                        ConfigurationTarget.Global
                    );
                    break;
            }
        }

        let options: ProgressOptions | undefined;
        let setting: OpenDataViewerSetting | undefined;

        switch (dataCleaningMode) {
            case 'standalone': {
                options = {
                    location: ProgressLocation.Notification,
                    cancellable: true,
                    title: 'Importing Data and Launching Data Viewer...'
                };
                setting = OpenDataViewerSetting.STANDALONE;

                break;
            }
            case 'jupyter_notebook': {
                options = {
                    location: ProgressLocation.Notification,
                    cancellable: true,
                    title: 'Importing Data and Launching Data Viewer with a Jupyter Notebook...'
                };
                setting = OpenDataViewerSetting.WITH_JUPYTER_NOTEBOOK;

                break;
            }
            case 'python_file': {
                options = {
                    location: ProgressLocation.Notification,
                    cancellable: true,
                    title: 'Importing Data and Launching Data Viewer with a Python file...'
                };
                setting = OpenDataViewerSetting.WITH_PYTHON_FILE;

                break;
            }
            case 'interactive_window': {
                options = {
                    location: ProgressLocation.Notification,
                    cancellable: true,
                    title: 'Importing Data and Launching Data Viewer with an Interactive Window...'
                };
                setting = OpenDataViewerSetting.WITH_INTERACTIVE_WINDOW;

                break;
            }
        }

        if (!options) return;

        await this.appShell.withProgress(options, async (_, __) =>
            this.importAndLaunchDataViewer(file, setting, source)
        );
    }

    public async importAndLaunchDataViewer(file: Uri, setting: OpenDataViewerSetting | undefined, source: 'custom_editor' | 'context_menu') {
        if (setting == OpenDataViewerSetting.STANDALONE) {
            const notebook = await this.notebookProvider.getOrCreateNotebook({
                resource: file,
                identity: file,
                disableUI: true
            });
            const code = getImportCodeForFileType(file!.fsPath);
            await notebook?.execute(code, '', 0, uuid(), undefined, true);
            await this.commandManager.executeCommand('jupyter.openVariableView');
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
            const jupyterVariableDataProvider = await this.jupyterVariableDataProviderFactory.create(
                jupyterVariable
            );
            jupyterVariableDataProvider.setDependencies(jupyterVariable, notebook);
            this.dataProviders.set(file, jupyterVariableDataProvider);
            // May need to resolve custom editor here
            if (source === 'context_menu') {
                await this.show(file, undefined);
            }
        } else if (setting == OpenDataViewerSetting.WITH_JUPYTER_NOTEBOOK) {
            const notebookEditor: INotebookEditor | undefined = await this.commandManager.executeCommand(Commands.CreateNewNotebook);
            if (!notebookEditor) {
                return;
            }
            // Add code cell to import dataframe
            const blankCell = (notebookEditor as any).document.cellAt(0) as NotebookCell;
            const code = getImportCodeForFileType(file!.fsPath);
            await updateCellCode(blankCell, code);
            // Run the cells
            await this.commandManager.executeCommand('notebook.cell.execute');
            await this.commandManager.executeCommand('jupyter.openVariableView');
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
            const jupyterVariableDataProvider = await this.jupyterVariableDataProviderFactory.create(
                jupyterVariable
            );
            jupyterVariableDataProvider.setDependencies(jupyterVariable, notebookEditor.notebook);
            this.dataProviders.set(file, jupyterVariableDataProvider);
            await this.show(file, undefined);
        } else if (setting == OpenDataViewerSetting.WITH_PYTHON_FILE) {
            //TODO
        } else {
            //interactive window
            //TODO
        }
    }
    
    private async show(file: Uri, webviewPanel: WebviewPanel | undefined) {
        const jupyterVariableDataProvider = this.dataProviders.get(file);
        if (!jupyterVariableDataProvider) return;
        const dataFrameInfo = await jupyterVariableDataProvider.getDataFrameInfo();
        const columnSize = dataFrameInfo?.columns?.length;
        if (columnSize && (await this.dataViewerChecker.isRequestedColumnSizeAllowed(columnSize))) {
            await this.dataViewerFactory.create(jupyterVariableDataProvider, 'Data Wrangler', webviewPanel);
        }
    }
}
