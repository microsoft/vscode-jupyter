import { injectable } from 'inversify';
import { NotebookCell, NotebookDocument, Uri } from 'vscode';
import { noop } from '../../common/utils/misc';
import { ICell, IDebuggingCellMap, INotebookExecutionLogger } from '../../datascience/types';

@injectable()
export class DebuggingCellMap implements IDebuggingCellMap, INotebookExecutionLogger {
    private static cellsToDump = new Map<NotebookDocument, NotebookCell[]>();

    public async preExecute(_cell: ICell, _silent: boolean): Promise<void> {
        noop();
    }
    public async postExecute(_cell: ICell, _silent: boolean, _language: string, _resource: Uri): Promise<void> {
        noop();
    }
    public async nativePostExecute(cell: NotebookCell): Promise<void> {
        const cells = DebuggingCellMap.cellsToDump.get(cell.notebook);
        if (cells) {
            cells.push(cell);
        } else {
            DebuggingCellMap.cellsToDump.set(cell.notebook, [cell]);
        }
    }
    public onKernelStarted(_resource: Uri): void {
        noop();
    }
    public onKernelRestarted(_resource: Uri): void {
        noop();
    }
    public dispose() {
        noop();
    }
    public getCellsAnClearQueue(doc: NotebookDocument): NotebookCell[] {
        const cells = DebuggingCellMap.cellsToDump.get(doc);
        if (cells) {
            DebuggingCellMap.cellsToDump.set(doc, []);
            return cells;
        }
        return [];
    }
}
