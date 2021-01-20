// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import {
    CancellationToken,
    CompletionContext,
    CompletionItem,
    CompletionItemProvider,
    Position,
    TextDocument
} from 'vscode';
import { IVSCodeNotebook } from '../../../common/application/types';
import { traceError } from '../../../common/logger';
import { isNotebookCell } from '../../../common/utils/misc';
import { INotebookProvider } from '../../types';
import { findAssociatedNotebookDocument } from '../helpers/helpers';

@injectable()
export class NotebookCompletionProvider implements CompletionItemProvider {
    constructor(
        @inject(IVSCodeNotebook) private readonly vscodeNotebook: IVSCodeNotebook,
        @inject(INotebookProvider) private readonly notebookProvider: INotebookProvider
    ) {}
    public async provideCompletionItems(
        document: TextDocument,
        position: Position,
        token: CancellationToken,
        _context: CompletionContext
    ): Promise<CompletionItem[]> {
        if (!isNotebookCell(document)) {
            return [];
        }

        const notebookDocument = findAssociatedNotebookDocument(document.uri, this.vscodeNotebook);
        if (!notebookDocument) {
            traceError(`Notebook not found for Cell ${document.uri.toString()}`);
            return [];
        }

        // Change kernel and update metadata (this can return `undefined`).
        // When calling `kernelProvider.getOrCreate` it will attempt to dispose the current kernel.
        const notebook = await this.notebookProvider.getOrCreateNotebook({
            resource: notebookDocument.uri,
            identity: notebookDocument.uri,
            getOnly: true
        });
        if (token.isCancellationRequested) {
            return [];
        }
        if (!notebook) {
            traceError(`Live Notebook not available for ${notebookDocument.uri.toString()}`);
            return [];
        }
        const result = await notebook.getCompletion(document.getText(), document.offsetAt(position), token);
        return result.matches.map((item) => {
            const completion: CompletionItem = {
                label: item
            };
            return completion;
        });
    }
}
