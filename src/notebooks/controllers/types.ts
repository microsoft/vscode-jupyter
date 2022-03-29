import * as vscode from 'vscode';
import { KernelConnectionMetadata } from '../../kernels/types';

export interface IVSCodeNotebookController {
    readonly connection: KernelConnectionMetadata;
    readonly controller: vscode.NotebookController;
    readonly id: string;
}
