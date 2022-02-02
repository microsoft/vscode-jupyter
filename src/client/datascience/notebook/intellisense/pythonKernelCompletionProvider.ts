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
    TextDocument,
    workspace
} from 'vscode';
import * as lsp from 'vscode-languageclient';
import { IVSCodeNotebook } from '../../../common/application/types';
import { createPromiseFromCancellation } from '../../../common/cancellation';
import { traceError, traceInfoIfCI, traceVerbose } from '../../../common/logger';
import { getDisplayPath } from '../../../common/platform/fs-paths';
import { IConfigurationService, IDisposableRegistry } from '../../../common/types';
import { waitForPromise } from '../../../common/utils/async';
import { isNotebookCell } from '../../../common/utils/misc';
import { StopWatch } from '../../../common/utils/stopWatch';
import { Settings } from '../../constants';
import { mapJupyterKind } from '../../interactive-common/intellisense/conversion';
import { IKernelProvider } from '../../jupyter/kernels/types';
import { IInteractiveWindowProvider, IJupyterSession, INotebookCompletion } from '../../types';
import { findAssociatedNotebookDocument } from '../helpers/helpers';
import { INotebookLanguageClientProvider } from '../types';

// Type that holds extra string (makes it quicker to filter). Exported for testing
export type JupyterCompletionItem = CompletionItem & {
    itemText: string;
};

/**
 * This class implements a CompletionItemProvider for python kernels using the jupyter requestCompletions message.
 */
@injectable()
export class PythonKernelCompletionProvider implements CompletionItemProvider {
    private allowStringFilter = false;
    constructor(
        @inject(IVSCodeNotebook) private readonly vscodeNotebook: IVSCodeNotebook,
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IInteractiveWindowProvider) private readonly interactiveWindowProvider: IInteractiveWindowProvider,
        @inject(INotebookLanguageClientProvider)
        private readonly languageClientProvider: INotebookLanguageClientProvider,
        @inject(IConfigurationService) config: IConfigurationService,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry
    ) {
        const triggerChars = config.getSettings().pythonCompletionTriggerCharacters;
        this.allowStringFilter =
            triggerChars != undefined && (triggerChars.includes("'") || triggerChars.includes('"'));
        workspace.onDidChangeConfiguration(
            (e) => {
                if (e.affectsConfiguration('jupyter.pythonCompletionTriggerCharacters')) {
                    const triggerChars = config.getSettings().pythonCompletionTriggerCharacters;
                    this.allowStringFilter =
                        triggerChars != undefined && (triggerChars.includes("'") || triggerChars.includes('"'));
                }
            },
            this,
            disposables
        );
    }
    public async provideCompletionItems(
        document: TextDocument,
        position: Position,
        token: CancellationToken,
        context: CompletionContext
    ): Promise<CompletionItem[]> {
        if (!isNotebookCell(document)) {
            return [];
        }
        const notebookDocument = findAssociatedNotebookDocument(
            document.uri,
            this.vscodeNotebook,
            this.interactiveWindowProvider
        );
        if (!notebookDocument) {
            traceError(`Notebook not found for Cell ${getDisplayPath(document.uri)}`);
            return [];
        }

        const kernel = this.kernelProvider.get(notebookDocument);
        if (!kernel || !kernel.session) {
            traceError(`Live Notebook not available for ${getDisplayPath(notebookDocument.uri)}`);
            return [];
        }
        // Allow slower timeouts for CI (testing).
        const timeout =
            parseInt(process.env.VSC_JUPYTER_IntellisenseTimeout || '0', 10) || Settings.IntellisenseTimeout;
        traceInfoIfCI(`Notebook completion request for ${document.getText()}, ${document.offsetAt(position)}`);
        const [result, pylanceResults] = await Promise.all([
            waitForPromise(
                this.getJupyterCompletion(kernel.session, document.getText(), document.offsetAt(position), token),
                timeout
            ),
            this.getPylanceCompletions(document, position, context, token)
        ]);
        if (!result) {
            traceInfoIfCI(`Notebook completions not found.`);
            return [];
        } else {
            traceInfoIfCI(`Completions found, filtering the list: ${JSON.stringify(result)}.`);
        }

        // Format results into a list of completions
        let completions: JupyterCompletionItem[] = [];

        const experimentMatches = result.metadata ? result.metadata._jupyter_types_experimental : [];
        // Check if we have more information about the completion items & whether its valid.
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
            completions = experimentMatches.map((item, index) => {
                const completion: JupyterCompletionItem = {
                    label: item.text,
                    itemText: item.text,
                    range: new Range(document.positionAt(item.start), document.positionAt(item.end)),
                    kind: item.type ? mapJupyterKind.get(item.type) : CompletionItemKind.Field,
                    sortText: generateSortString(index)
                };
                return completion;
            });
        } else {
            completions = result.matches.map((item, index) => {
                const completion: JupyterCompletionItem = {
                    label: item,
                    itemText: item,
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

        // Filter the list based on where we are in a cell (and the type of cell)
        return filterCompletions(
            context.triggerCharacter,
            this.allowStringFilter,
            completions,
            pylanceResults,
            document,
            position
        );
    }
    public async getJupyterCompletion(
        session: IJupyterSession,
        cellCode: string,
        offsetInCode: number,
        cancelToken?: CancellationToken
    ): Promise<INotebookCompletion> {
        const stopWatch = new StopWatch();
        // If server is busy, then don't delay code completion.
        if (session.status === 'busy') {
            return {
                matches: [],
                cursor: { start: 0, end: 0 },
                metadata: {}
            };
        }
        const result = await Promise.race([
            session.requestComplete({
                code: cellCode,
                cursor_pos: offsetInCode
            }),
            createPromiseFromCancellation({ defaultValue: undefined, cancelAction: 'resolve', token: cancelToken })
        ]);
        traceInfoIfCI(
            `Got jupyter notebook completions. Is cancel? ${cancelToken?.isCancellationRequested}: ${
                result ? JSON.stringify(result) : 'empty'
            }`
        );
        traceVerbose(`Jupyter completion time: ${stopWatch.elapsedTime}`);
        if (result && result.content) {
            if ('matches' in result.content) {
                return {
                    matches: result.content.matches,
                    cursor: {
                        start: result.content.cursor_start,
                        end: result.content.cursor_end
                    },
                    metadata: result.content.metadata
                };
            }
        }
        return {
            matches: [],
            cursor: { start: 0, end: 0 },
            metadata: {}
        };
    }

    private async getPylanceCompletions(
        document: TextDocument,
        position: Position,
        context: CompletionContext,
        cancelToken: CancellationToken
    ) {
        if (document.notebook) {
            const client = await this.languageClientProvider.getLanguageClient(document.notebook);
            if (client) {
                // Use provider so it gets translated by middleware
                const feature = client.getFeature(lsp.CompletionRequest.method);
                const provider = feature.getProvider(document);
                if (provider) {
                    const results = await provider.provideCompletionItems(document, position, cancelToken, context);
                    if (results && 'items' in results) {
                        return results.items;
                    } else {
                        return results;
                    }
                }
            }
        }
    }
}

function positionInsideString(word: string, position: Position) {
    const indexDoubleQuote = word.indexOf('"');
    const indexSingleQuote = word.indexOf("'");
    const lastIndexDoubleQuote = word.lastIndexOf('"');
    const lastIndexSingleQuote = word.lastIndexOf("'");
    const index = indexDoubleQuote >= 0 ? indexDoubleQuote : indexSingleQuote;
    const lastIndex = lastIndexDoubleQuote >= 0 ? lastIndexDoubleQuote : lastIndexSingleQuote;
    return index >= 0 && position.character > index && position.character <= lastIndex;
}

export function generateSortString(index: number) {
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

// Exported for unit testing
export function filterCompletions(
    triggerCharacter: string | undefined,
    allowStringFilter: boolean,
    completions: JupyterCompletionItem[],
    pylanceResults: CompletionItem[] | null | undefined,
    cell: TextDocument,
    position: Position
) {
    let result = completions;
    const charBeforeCursorPosition =
        position.character === 0
            ? undefined
            : new Range(position.line, position.character - 1, position.line, position.character);
    const charBeforeCursor = charBeforeCursorPosition ? cell.getText(charBeforeCursorPosition) : undefined;
    const isPreviousCharTriggerCharacter = charBeforeCursor === '.';
    const wordRange = cell.getWordRangeAtPosition(
        isPreviousCharTriggerCharacter || triggerCharacter === '.'
            ? new Position(position.line, position.character - 1)
            : position
    );
    const wordRangeWithTriggerCharacter =
        wordRange && charBeforeCursorPosition ? wordRange.union(charBeforeCursorPosition) : undefined;
    const word = wordRangeWithTriggerCharacter
        ? cell.getText(wordRangeWithTriggerCharacter)
        : cell.lineAt(position.line).text;
    const wordDot = word.endsWith('.') || isPreviousCharTriggerCharacter;
    const insideString =
        allowStringFilter &&
        (triggerCharacter == "'" || triggerCharacter == '"' || positionInsideString(word, position));

    // If inside of a string, filter out everything except file names
    if (insideString) {
        result = result.filter((r) => r.itemText.includes('.') || r.itemText.endsWith('/'));
    }

    // Update magics to have a much lower sort order than other strings.
    // Also change things that start with our current word to eliminate the
    // extra long label.
    result = result.map((r, i) => {
        if (r.itemText.startsWith('%') || r.itemText.startsWith('!')) {
            return {
                ...r,
                sortText: `ZZZ${r.sortText}`
            };
        }
        // Do nothing for paths and the like inside strings.
        if (insideString) {
            return r;
        }

        const wordIndex = word ? r.itemText.indexOf(word) : -1;
        let newLabel: string | undefined = undefined;
        let newText: string | undefined = undefined;
        let newRange: Range | { inserting: Range; replacing: Range } | undefined = undefined;

        // Two cases for filtering. We're at the '.', then the word we have is the beginning of the string.
        // Example, user typed 'df.' and r.itemText is 'df.PassengerId'. Word would be 'df.' in this case.
        if (word && wordDot && r.itemText.includes(word)) {
            newLabel = r.itemText.substring(r.itemText.indexOf(word) + (wordDot ? word.length : 0));
            newText = r.itemText.substring(r.itemText.indexOf(word) + word.length);
            const changeInCharacters =
                (typeof r.label === 'string' ? r.label.length : r.label.label.length) - newText.length;
            newRange =
                r.range && 'start' in r.range
                    ? new Range(
                          new Position(r.range.start.line, r.range.start.character + changeInCharacters),
                          r.range.end
                      )
                    : r.range;
        }
        // We're after the '.' and the user is typing more. We are in the middle of the string then.
        // Example, user typed 'df.Pass' and r.itemText is 'df.PassengerId'. Word would be 'Pass' in this case.
        if (!newText && wordIndex > 0) {
            newLabel = r.itemText.substring(r.itemText.indexOf(word) + (wordDot ? word.length : 0));
            newText = r.itemText.substring(r.itemText.indexOf(word) + word.length);
            const changeInCharacters =
                (typeof r.label === 'string' ? r.label.length : r.label.label.length) - newText.length;
            newRange =
                r.range && 'start' in r.range
                    ? new Range(
                          new Position(r.range.start.line, r.range.start.character + changeInCharacters),
                          r.range.end
                      )
                    : r.range;
        }
        if (newLabel && newText && newRange) {
            r.label = newLabel;
            r.itemText = newText;
            r.insertText = newText;
            r.filterText = wordDot ? `.${newText}` : newText;
            r.range = newRange;
            r.sortText = generateSortString(i);
        }
        return r;
    });

    // If not inside of a string, filter out file names (things that end with '/')
    if (!insideString) {
        result = result.filter((r) => !r.itemText.includes('.') && !r.itemText.endsWith('/'));
    } else {
        // If inside a string and ending with '/', then add a command to force a suggestion right after
        result = result.map((r) => {
            if (r.itemText.endsWith('/')) {
                return {
                    ...r,
                    command: {
                        command: 'editor.action.triggerSuggest',
                        title: ''
                    }
                };
            }
            // Sometimes we have items with spaces, and Jupyter escapes spaces with `\ `
            if (r.itemText.includes(' ')) {
                r.itemText = r.itemText.replace(/\\ /g, ' ');
                if (typeof r.label === 'string') {
                    r.label = r.label.replace(/\\ /g, ' ');
                } else {
                    r.label.label = r.label.label.replace(/\\ /g, ' ');
                }
            }
            return r;
        });
    }

    // Remove any duplicates (picking pylance over jupyter)
    if (pylanceResults) {
        const set = new Set(pylanceResults.map((p) => p.label.toString()));
        result = result.filter((r) => !set.has(r.itemText));
    }

    traceVerbose(
        `Jupyter completions for ${word} at pos ${position.line}:${
            position.character
        } with trigger: ${triggerCharacter}\n   ${completions.map((r) => r.label).join(',')}`
    );

    traceVerbose(
        `Jupyter results for ${word} at pos ${position.line}:${
            position.character
        } with trigger: ${triggerCharacter}\n   ${result.map((r) => r.label).join(',')}`
    );

    return result;
}
