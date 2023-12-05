// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, optional } from 'inversify';
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
import { raceCancellation } from '../../platform/common/cancellation';
import { traceError, traceInfoIfCI, traceVerbose } from '../../platform/logging';
import { getDisplayPath } from '../../platform/common/platform/fs-paths';
import { IConfigurationService, IDisposableRegistry } from '../../platform/common/types';
import { isNotebookCell, noop } from '../../platform/common/utils/misc';
import { StopWatch } from '../../platform/common/utils/stopWatch';
import { IKernelSession, IKernelProvider, IKernel } from '../../kernels/types';
import { INotebookCompletionProvider, INotebookEditorProvider } from '../../notebooks/types';
import { mapJupyterKind } from './conversion';
import { isTestExecution, PYTHON_LANGUAGE, Settings, Telemetry } from '../../platform/common/constants';
import { INotebookCompletion } from './types';
import { getAssociatedJupyterNotebook } from '../../platform/common/utils';
import { raceTimeout } from '../../platform/common/utils/async';
import { isPythonKernelConnection } from '../../kernels/helpers';
import { sendTelemetryEvent } from '../../telemetry';
import { getTelemetrySafeHashedString } from '../../platform/telemetry/helpers';
import { generateSortString } from './helpers';
import { resolveCompletionItem } from './resolveCompletionItem';
import { DisposableStore } from '../../platform/common/utils/lifecycle';

let IntellisenseTimeout = Settings.IntellisenseTimeout;
export function setIntellisenseTimeout(timeoutMs: number) {
    IntellisenseTimeout = timeoutMs;
}

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
    private readonly toDispose = new DisposableStore();
    private completionItemsSent = new WeakMap<
        CompletionItem,
        {
            documentRef: WeakRef<TextDocument>;
            kernelRef: WeakRef<IKernel>;
            duration: number;
            kernelId: string;
            position: Position;
        }
    >();

    constructor(
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(INotebookEditorProvider) private readonly notebookEditorProvider: INotebookEditorProvider,
        @inject(INotebookCompletionProvider)
        @optional()
        private readonly notebookCompletionProvider: INotebookCompletionProvider | undefined,
        @inject(IConfigurationService) config: IConfigurationService,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry
    ) {
        disposables.push(this.toDispose);
        this.kernelProvider.onDidStartKernel(
            (kernel) => {
                if (kernel.session?.kernel && isPythonKernelConnection(kernel.kernelConnectionMetadata)) {
                    /**
                     * Do not wait for completions,
                     * If the completions request crashes then we don't get a response for this request,
                     * Hence we end up waiting indefinitely.
                     * https://github.com/microsoft/vscode-jupyter/issues/9014
                     *
                     * We send this request to ensure the completion provider in the kernel has bee pre-warmed.
                     * This way things are faster when the user actually triggers a completion.
                     */
                    kernel.session.kernel.requestComplete({ code: '__file__.', cursor_pos: 9 }).catch(noop);
                }
            },
            this,
            disposables
        );

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
        const stopWatch = new StopWatch();
        if (!isNotebookCell(document)) {
            return [];
        }
        const notebookDocument = this.notebookEditorProvider.findAssociatedNotebookDocument(document.uri);
        if (!notebookDocument) {
            traceError(`Notebook not found for Cell ${getDisplayPath(document.uri)}`);
            return [];
        }

        const kernel = this.kernelProvider.get(notebookDocument);
        if (!kernel || !kernel.session || !kernel.session.kernel) {
            traceVerbose(`Live Notebook not available for ${getDisplayPath(notebookDocument.uri)}`);
            return [];
        }
        // Allow slower timeouts for CI (testing).
        traceInfoIfCI(`Notebook completion request for ${document.getText()}, ${document.offsetAt(position)}`);
        const [result, pylanceResults, kernelId] = await Promise.all([
            raceTimeout(
                IntellisenseTimeout,
                this.getJupyterCompletion(kernel.session, document.getText(), document.offsetAt(position), token)
            ),
            raceTimeout(IntellisenseTimeout, this.getPylanceCompletions(document, position, context, token)),
            getTelemetrySafeHashedString(kernel.kernelConnectionMetadata.id)
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
        completions = filterCompletions(
            context.triggerCharacter,
            this.allowStringFilter,
            completions,
            pylanceResults,
            document,
            position
        );
        const documentRef = new WeakRef(document);
        const kernelRef = new WeakRef(kernel);
        const duration = stopWatch.elapsedTime;
        completions.forEach((item) =>
            this.completionItemsSent.set(item, {
                documentRef,
                kernelRef,
                duration,
                kernelId,
                position
            })
        );
        sendTelemetryEvent(
            Telemetry.KernelCodeCompletion,
            { duration, completionItems: completions.length, requestDuration: duration },
            {
                kernelId,
                kernelConnectionType: kernel.kernelConnectionMetadata.kind,
                kernelLanguage: PYTHON_LANGUAGE,
                monacoLanguage: PYTHON_LANGUAGE,
                cancelled: token.isCancellationRequested,
                completed: true,
                requestSent: true,
                kernelStatusAfterRequest: kernel.status
            }
        );
        return completions;
    }
    async resolveCompletionItem(item: CompletionItem, token: CancellationToken): Promise<CompletionItem> {
        const info = this.completionItemsSent.get(item);
        if (!info) {
            return item;
        }
        const { kernelId, kernelRef, documentRef, position } = info;
        const document = documentRef.deref();
        const kernel = kernelRef.deref();
        if (!document || !kernel || !kernel.session?.kernel) {
            return item;
        }
        return resolveCompletionItem(
            item,
            token,
            kernel,
            kernelId,
            PYTHON_LANGUAGE,
            document,
            position,
            this.toDispose
        );
    }

    public async getJupyterCompletion(
        session: IKernelSession,
        cellCode: string,
        offsetInCode: number,
        cancelToken?: CancellationToken
    ): Promise<INotebookCompletion> {
        const stopWatch = new StopWatch();
        if (!session.kernel) {
            return {
                matches: [],
                cursor: { start: 0, end: 0 },
                metadata: {}
            };
        }
        // If server is busy, then don't send code completions. Otherwise
        // they can stack up and slow down the server significantly.
        // However during testing we'll just wait.
        if (session.status === 'busy' && !isTestExecution()) {
            return {
                matches: [],
                cursor: { start: 0, end: 0 },
                metadata: {}
            };
        }
        const result = await raceCancellation(
            cancelToken,
            session.kernel.requestComplete({
                code: cellCode,
                cursor_pos: offsetInCode
            })
        );
        traceInfoIfCI(
            `Got jupyter notebook completions. Is cancel? ${cancelToken?.isCancellationRequested}: ${
                result ? JSON.stringify(result) : 'empty'
            }`
        );
        const matches = result && result.content && 'matches' in result.content ? result.content.matches : [];
        traceVerbose(
            `Jupyter completion for ${cellCode} (cancelled=${cancelToken?.isCancellationRequested}) with ${matches.length} items, in ${stopWatch.elapsedTime}`
        );
        if (result && result.content && 'matches' in result.content) {
            return {
                matches,
                cursor: {
                    start: result.content.cursor_start,
                    end: result.content.cursor_end
                },
                metadata: result.content.metadata
            };
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
        const notebook = getAssociatedJupyterNotebook(document);
        if (notebook && this.notebookCompletionProvider) {
            return this.notebookCompletionProvider.getCompletions(notebook, document, position, context, cancelToken);
        }
    }
}

function positionInsideString(line: string, position: Position) {
    const indexDoubleQuote = line.indexOf('"');
    const indexSingleQuote = line.indexOf("'");
    const lastIndexDoubleQuote = line.lastIndexOf('"');
    const lastIndexSingleQuote = line.lastIndexOf("'");
    const index = indexDoubleQuote >= 0 ? indexDoubleQuote : indexSingleQuote;
    const lastIndex = lastIndexDoubleQuote >= 0 ? lastIndexDoubleQuote : lastIndexSingleQuote;
    return index >= 0 && position.character > index && position.character <= lastIndex;
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
    const line = cell.lineAt(position.line).text;
    const word = wordRangeWithTriggerCharacter ? cell.getText(wordRangeWithTriggerCharacter) : line;
    const wordDot = word.endsWith('.') || isPreviousCharTriggerCharacter;
    const insideString =
        allowStringFilter &&
        (triggerCharacter == "'" || triggerCharacter == '"' || positionInsideString(line, position));

    traceInfoIfCI(`Jupyter completions filtering applied: ${insideString} on ${line}`);

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

    traceInfoIfCI(
        `Jupyter completions for ${word} at pos ${position.line}:${
            position.character
        } with trigger: ${triggerCharacter}\n   ${completions.map((r) => r.label).join(',')}`
    );

    traceInfoIfCI(
        `Jupyter results for ${word} at pos ${position.line}:${
            position.character
        } with trigger: ${triggerCharacter}\n   ${result.map((r) => r.label).join(',')}`
    );

    return result;
}
