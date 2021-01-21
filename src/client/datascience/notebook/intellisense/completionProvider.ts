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
import { traceError, traceInfo } from '../../../common/logger';
import { IFileSystem } from '../../../common/platform/types';
import { sleep } from '../../../common/utils/async';
import { isNotebookCell } from '../../../common/utils/misc';
import { Settings } from '../../constants';
import { INotebookCompletion, INotebookProvider } from '../../types';
import { findAssociatedNotebookDocument } from '../helpers/helpers';

@injectable()
export class NotebookCompletionProvider implements CompletionItemProvider {
    constructor(
        @inject(IVSCodeNotebook) private readonly vscodeNotebook: IVSCodeNotebook,
        @inject(INotebookProvider) private readonly notebookProvider: INotebookProvider,
        @inject(IFileSystem) private readonly fs: IFileSystem
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

        const notebookDocument = findAssociatedNotebookDocument(document.uri, this.vscodeNotebook, this.fs);
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
        const emptyResult: INotebookCompletion = { cursor: { end: 0, start: 0 }, matches: [], metadata: {} };
        // Allow slower timeouts for CI (testing).
        const timeout =
            parseInt(process.env.VSC_JUPYTER_IntellisenseTimeout || '0', 10) || Settings.IntellisenseTimeout;
        traceInfo(
            `process.env.VSC_JUPYTER_IntellisenseTimeout = ${process.env.VSC_JUPYTER_IntellisenseTimeout} & timeout = ${timeout}`
        );
        const result = await Promise.race([
            notebook.getCompletion(document.getText(), document.offsetAt(position), token),
            sleep(timeout).then(() => emptyResult)
        ]);
        return result.matches.map((item) => {
            const completion: CompletionItem = {
                label: item
            };
            return completion;
        });
    }
}
