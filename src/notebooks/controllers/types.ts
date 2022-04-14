/* eslint-disable @typescript-eslint/no-explicit-any */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { KernelConnectionMetadata } from '../../kernels/types';

export interface IVSCodeNotebookController {
    readonly connection: KernelConnectionMetadata;
    readonly controller: vscode.NotebookController;
    readonly id: string;
    readonly label: string;
    readonly onDidReceiveMessage: vscode.Event<{ editor: vscode.NotebookEditor; message: any }>;
    postMessage(message: any, editor?: vscode.NotebookEditor): Thenable<boolean>;
    asWebviewUri(localResource: vscode.Uri): vscode.Uri;
}
