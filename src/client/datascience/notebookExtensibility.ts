import { NotebookCell, Uri } from 'vscode';

export type KernelStateEventArgs = {
    resource: Uri;
    state: KernelState;
    cell?: NotebookCell;
    silent?: boolean;
};

export enum KernelState {
    executed,
    restarted
}
