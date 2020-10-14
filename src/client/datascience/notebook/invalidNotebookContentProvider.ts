import { CancellationToken, EventEmitter, Uri } from 'vscode';
import type {
    NotebookCommunication,
    NotebookContentProvider as VSCNotebookContentProvider,
    NotebookData,
    NotebookDocument,
    NotebookDocumentBackup,
    NotebookDocumentBackupContext,
    NotebookDocumentContentChangeEvent,
    NotebookDocumentOpenContext
} from '../../../../types/vscode-proposed';

export class InvalidNotebookContentProvider implements VSCNotebookContentProvider {
    public get onDidChangeNotebook() {
        return this.notebookChanged.event;
    }
    private notebookChanged = new EventEmitter<NotebookDocumentContentChangeEvent>();
    public async resolveNotebook(_document: NotebookDocument, _webview: NotebookCommunication): Promise<void> {
        // Later
    }
    public async openNotebook(_uri: Uri, _openContext: NotebookDocumentOpenContext): Promise<NotebookData> {
        throw new Error('The Jupyter notebook preview editor can only be used in VS code insiders');
    }
    public async saveNotebook(_document: NotebookDocument, _cancellation: CancellationToken) {
        throw new Error('Not Implemented');
    }

    public async saveNotebookAs(
        _targetResource: Uri,
        _document: NotebookDocument,
        _cancellation: CancellationToken
    ): Promise<void> {
        throw new Error('Not Implemented');
    }
    public async backupNotebook(
        _document: NotebookDocument,
        _context: NotebookDocumentBackupContext,
        _cancellation: CancellationToken
    ): Promise<NotebookDocumentBackup> {
        throw new Error('Not Implemented');
    }
}
