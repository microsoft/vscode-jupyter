import { injectable, inject, named } from 'inversify';
import { noop } from 'lodash';
import { CustomDocument, Event, WebviewPanel, Uri, CustomDocumentEditEvent, EventEmitter, window } from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { IDataWranglerProvider } from '../../common/application/types';
import * as uuid from 'uuid/v4';
import { getImportCodeForFileType } from '../commands/commandRegistry';
import { Identifiers } from '../constants';
import { IJupyterVariableDataProviderFactory, INotebookProvider, IJupyterVariables, INotebook } from '../types';
import { IDataViewerDataProvider, IDataViewerFactory } from './types';

@injectable()
export class DataWranglerProvider implements IDataWranglerProvider, IExtensionSingleActivationService {
	public get onDidChangeCustomDocument(): Event<CustomDocumentEditEvent> {
        return this._onDidEdit.event;
    }
	protected readonly _onDidEdit = new EventEmitter<CustomDocumentEditEvent>();

	private notebooks = new Map<Uri, INotebook>();
	private dataProviders = new Map<Uri, IDataViewerDataProvider>();

	constructor(
		@inject(IJupyterVariableDataProviderFactory)
        private readonly jupyterVariableDataProviderFactory: IJupyterVariableDataProviderFactory,
        @inject(IDataViewerFactory) private readonly dataViewerFactory: IDataViewerFactory,
		@inject(INotebookProvider) private notebookProvider: INotebookProvider,
		@inject(IJupyterVariables)
        @named(Identifiers.KERNEL_VARIABLES)
        private kernelVariableProvider: IJupyterVariables,
	) {
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
	public async openCustomDocument(
        file: Uri
    ): Promise<CustomDocument> {
		const notebook = await this.notebookProvider.getOrCreateNotebook({ resource: file, identity: file, disableUI: false });
		if (!notebook) {
			throw new Error(`Failed to create a Jupyter notebook for ${file.path}`);
		}
		const code = getImportCodeForFileType(file.fsPath);
		await notebook?.execute(code, '', 0, uuid(), undefined, true);
		// Open data viewer for this variable
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
		this.notebooks.set(file, notebook);
		return { uri: file, dispose: noop };
	}

	/**
	 * Here our extension must fill in the initial html for the custom editor. If we need, 
	 * we can also hold onto a reference to the WebviewPanel so that we can reference it 
	 * later, for example inside commands.
	 */
	public async resolveCustomEditor(document: CustomDocument, panel: WebviewPanel) {
		const jupyterVariableDataProvider = this.dataProviders.get(document.uri);
		if (!jupyterVariableDataProvider) return;
		const dataFrameInfo = await jupyterVariableDataProvider.getDataFrameInfo();
		const columnSize = dataFrameInfo?.columns?.length;
		if (columnSize/* && (await this.dataViewerChecker.isRequestedColumnSizeAllowed(columnSize))*/) {
			const title: string = `Data Wrangler`;
			await this.dataViewerFactory.create(jupyterVariableDataProvider, title, panel);
		}
	}
}
