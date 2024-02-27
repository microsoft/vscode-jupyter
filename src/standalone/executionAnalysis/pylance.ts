// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import type { BaseLanguageClient } from 'vscode-languageclient';
import { LocationWithReferenceKind, PylanceExtension, noop } from './common';

export interface ILanguageServerFolder {
    path: string;
    version: string; // SemVer, in string form to avoid cross-extension type issues.
}

export interface INotebookLanguageClient {
    registerJupyterPythonPathFunction(func: (uri: vscode.Uri) => Promise<string | undefined>): void;
    registerGetNotebookUriForTextDocumentUriFunction(
        func: (textDocumentUri: vscode.Uri) => vscode.Uri | undefined
    ): void;
    getCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.CompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.CompletionItem[] | vscode.CompletionList | undefined>;
    getReferences(
        textDocument: vscode.TextDocument,
        position: vscode.Position,
        options: {
            includeDeclaration: boolean;
        },
        token: vscode.CancellationToken
    ): Promise<LocationWithReferenceKind[] | null | undefined>;
    getDocumentSymbols(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): Promise<vscode.DocumentSymbol[] | undefined>;
}

export interface LSExtensionApi {
    languageServerFolder?(): Promise<ILanguageServerFolder>;
    client?: {
        isEnabled(): boolean;
        start(): Promise<void>;
        stop(): Promise<void>;
    };
    notebook?: INotebookLanguageClient;
}

export interface PythonApi {
    readonly pylance?: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        createClient(...args: any[]): BaseLanguageClient;
        start(client: BaseLanguageClient): Promise<void>;
        stop(client: BaseLanguageClient): Promise<void>;
    };
}

export async function runPylance(pylanceExtension: vscode.Extension<LSExtensionApi>) {
    const pylanceApi = await pylanceExtension.activate();
    return pylanceApi;
}

let _client: INotebookLanguageClient | undefined;
export async function activatePylance(): Promise<INotebookLanguageClient | undefined> {
    const pylanceExtension = vscode.extensions.getExtension(PylanceExtension);
    if (!pylanceExtension) {
        return undefined;
    }

    if (_client) {
        return _client;
    }

    return new Promise((resolve, reject) => {
        runPylance(pylanceExtension)
            .then(async (client) => {
                if (!client) {
                    console.error('Could not start Pylance');
                    reject();
                    return;
                }

                if (client.client) {
                    await client.client.start();
                }

                _client = client.notebook;
                resolve(client.notebook);
            })
            .then(noop, noop);
    });
}
