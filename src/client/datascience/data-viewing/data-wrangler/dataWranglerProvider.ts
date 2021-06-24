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
    ProgressLocation
} from 'vscode';
import { IExtensionSingleActivationService } from '../../../activation/types';
import { IApplicationShell, IDataWranglerProvider } from '../../../common/application/types';
import * as uuid from 'uuid/v4';
import { Identifiers } from '../../constants';
import { INotebookProvider, IJupyterVariables, IJupyterVariableDataProviderFactory } from '../../types';
import { DataViewerChecker } from '../../interactive-common/dataViewerChecker';
import { IConfigurationService } from '../../../common/types';
import { IDataWranglerFactory } from './types';
import { DataScience } from '../../../common/utils/localize';
import { IDataViewerDataProvider } from '../types';

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
        @inject(IDataWranglerFactory) private readonly dataWranglerFactory: IDataWranglerFactory,
        @inject(INotebookProvider) private notebookProvider: INotebookProvider,
        @inject(IJupyterVariables)
        @named(Identifiers.KERNEL_VARIABLES)
        private kernelVariableProvider: IJupyterVariables,
        @inject(IConfigurationService) configService: IConfigurationService,
        @inject(IApplicationShell) private appShell: IApplicationShell
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
        const options = {
            location: ProgressLocation.Notification,
            cancellable: true,
            title: DataScience.dataWranglerStandaloneLoading()
        };

        await this.appShell.withProgress(options, async (_, __) => this.importAndLaunchDataWrangler(file, source));
    }

    public async importAndLaunchDataWrangler(file: Uri, source: 'custom_editor' | 'context_menu') {
        const notebook = await this.notebookProvider.getOrCreateNotebook({
            resource: file,
            identity: file,
            disableUI: true
        });
        const code = this.getImportCodeForFileType(file!.fsPath);
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
        const jupyterVariableDataProvider = await this.jupyterVariableDataProviderFactory.create(jupyterVariable);
        jupyterVariableDataProvider.setDependencies(jupyterVariable, notebook);
        this.dataProviders.set(file, jupyterVariableDataProvider);
        // May need to resolve custom editor here
        if (source === 'context_menu') {
            await this.show(file, undefined);
        }
    }

    private async show(file: Uri, webviewPanel: WebviewPanel | undefined) {
        const jupyterVariableDataProvider = this.dataProviders.get(file);
        if (!jupyterVariableDataProvider) return;
        const dataFrameInfo = await jupyterVariableDataProvider.getDataFrameInfo();
        const columnSize = dataFrameInfo?.columns?.length;
        if (columnSize && (await this.dataViewerChecker.isRequestedColumnSizeAllowed(columnSize))) {
            await this.dataWranglerFactory.create(
                jupyterVariableDataProvider,
                DataScience.dataWranglerTitle(),
                webviewPanel
            );
        }
    }

    private getImportCodeForFileType(filepath: string) {
        const code = DataScience.dataWranglerImportCode().format(filepath);
        return code;
    }
}
