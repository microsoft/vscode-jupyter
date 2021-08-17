// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import {
    CancellationToken,
    CompletionContext,
    CompletionItem,
    CompletionItemKind,
    CompletionItemProvider,
    Position,
    Range,
    TextDocument
} from 'vscode';
import { IVSCodeNotebook } from '../../../common/application/types';
import { isCI } from '../../../common/constants';
import { traceError, traceInfoIf } from '../../../common/logger';
import { IFileSystem } from '../../../common/platform/types';
import { sleep } from '../../../common/utils/async';
import { isNotebookCell } from '../../../common/utils/misc';
import { Settings } from '../../constants';
import { mapJupyterKind } from '../../interactive-common/intellisense/conversion';
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
            traceInfoIf(isCI, `Getting completions cancelled for ${notebookDocument.uri.toString()}`);
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
        const result = await Promise.race([
            notebook.getCompletion(document.getText(), document.offsetAt(position), token),
            sleep(timeout).then(() => {
                if (token.isCancellationRequested) {
                    return;
                }
                traceInfoIf(isCI, `Notebook completions request timed out for Cell ${document.uri.toString()}`);
                return emptyResult;
            })
        ]);
        if (!result) {
            return [];
        }
        const experimentMatches = result.metadata ? result.metadata._jupyter_types_experimental : [];
        // Check if we have more information about the complication items & whether its valid.
        // This will ensure that we don't regress (as long as all items are valid & we have the same number of completions items
        // then we should be able to use the experiment matches value)
        if (
            Array.isArray(experimentMatches) &&
            experimentMatches.length >= result.matches.length &&
            experimentMatches.every(
                (item) =>
                    typeof item.start === 'number' && typeof item.end === 'number' && typeof item.text === 'string'
            )
        ) {
            return experimentMatches.map((item, index) => {
                const completion: CompletionItem = {
                    label: item.text,
                    range: new Range(document.positionAt(item.start), document.positionAt(item.end)),
                    kind: item.type ? mapJupyterKind.get(item.type) : CompletionItemKind.Field,
                    sortText: generateSortString(index)
                };
                return completion;
            });
        }
        return result.matches.map((item, index) => {
            const completion: CompletionItem = {
                label: item,
                sortText: generateSortString(index)
                // Ideall we need to provide a range here, as we don't, VS Code will
                // assume the current word needs to be replaced.
                // E.g. if you type in `os.env` and get complications from jupyter as `os.environ`, then
                // vscode will replace `env` with `os.environ`, as it replaces the word.
                // Leaving comment here so we know whats going on.
                // We cannot hardcode anything without any knowledge of what we're getting back.
            };
            return completion;
        });
    }
}

function generateSortString(index: number) {
    // If its 0, then use AA, if 25, then use ZZ
    // This will give us the ability to sort first 700 items (thats more than enough).
    // To keep things fast we'll only sort the first 300.
    if (index >= 300) {
        return 'ZZZZZZZ';
    }
    if (index <= 25) {
        return `A${String.fromCharCode(65 + index)}`;
    }
    const firstChar = String.fromCharCode(65 + Math.ceil(index / 25));
    const secondChar = String.fromCharCode(65 + (index % 25));
    return `${firstChar}${secondChar}`;
}
