// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import {
    CancellationToken,
    CompletionContext,
    CompletionItem,
    CompletionItemKind,
    CompletionItemProvider,
    CompletionList,
    Position,
    Range,
    TextDocument,
    commands,
    l10n,
    languages,
    workspace
} from 'vscode';
import { raceCancellation } from '../../platform/common/cancellation';
import { traceInfo, traceInfoIfCI, traceVerbose, traceWarning } from '../../platform/logging';
import {
    Experiments,
    IDisposable,
    IDisposableRegistry,
    IExperimentService,
    Resource
} from '../../platform/common/types';
import { StopWatch } from '../../platform/common/utils/stopWatch';
import { IKernelProvider, IKernel } from '../../kernels/types';
import { INotebookEditorProvider } from '../../notebooks/types';
import { mapJupyterKind } from './conversion';
import { PYTHON_LANGUAGE, Telemetry } from '../../platform/common/constants';
import { INotebookCompletion } from './types';
import { translateKernelLanguageToMonaco } from '../../platform/common/utils';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { ServiceContainer } from '../../platform/ioc/container';
import { DisposableBase, DisposableStore } from '../../platform/common/utils/lifecycle';
import { raceTimeout, sleep } from '../../platform/common/utils/async';
import { TelemetryMeasures, TelemetryProperties, sendTelemetryEvent } from '../../telemetry';
import { getTelemetrySafeHashedString } from '../../platform/telemetry/helpers';
import { getDisplayNameOrNameOfKernelConnection, isPythonKernelConnection } from '../../kernels/helpers';
import { generateSortString } from './helpers';
import { resolveCompletionItem } from './resolveCompletionItem';

export class NotebookCellSpecificKernelCompletionProvider implements CompletionItemProvider {
    constructor(
        private readonly kernelId: string,
        private readonly kernel: IKernel,
        private readonly monacoLanguage: string,
        private readonly toDispose: DisposableStore
    ) {}
    public allowStringFilterForPython: boolean;
    private pendingCompletionRequest = new WeakMap<TextDocument, { position: Position; version: number }>();
    private previousCompletionItems = new WeakMap<
        CompletionItem,
        { documentRef: WeakRef<TextDocument>; position: Position; originalCompletionItem: CompletionItem }
    >();
    async provideCompletionItems(
        document: TextDocument,
        position: Position,
        token: CancellationToken,
        context: CompletionContext
    ): Promise<CompletionItem[]> {
        if (!this.kernel.session?.kernel) {
            return [];
        }
        // Most likely being called again by us in getCompletionsFromOtherLanguageProviders
        if (
            this.pendingCompletionRequest.get(document)?.position.isEqual(position) &&
            this.pendingCompletionRequest.get(document)?.version === document.version
        ) {
            return [];
        }
        this.pendingCompletionRequest.set(document, { position, version: document.version });
        try {
            // Request completions from other language providers.
            // Do this early, as we know kernel completions will take longer.
            const completionsFromOtherSourcesPromise = raceCancellation(
                token,
                (
                    Promise.resolve(
                        commands.executeCommand('vscode.executeCompletionItemProvider', document.uri, position)
                    ) as Promise<CompletionList | undefined>
                ).then((result) => result?.items || [])
            );

            // Wait for 100ms, as we do not want to flood the kernel with too many messages.
            // if after 100ms, the token isn't cancelled, then send the request.
            await sleep(100);
            if (token.isCancellationRequested) {
                return [];
            }
            const completions = await this.provideCompletionItemsFromKernel(document, position, token, context);
            if (token.isCancellationRequested) {
                return [];
            }
            // Wait no longer than the kernel takes to provide the completions,
            // If kernel is faster than other language providers, then so be it.
            // Adding delays here could just slow things down in VS Code.
            // NOTE: We have already waited for 100ms earlier.
            const otherCompletions = await raceTimeout(0, completionsFromOtherSourcesPromise);

            const existingCompletionItems = new Set(
                (otherCompletions || []).map((item) => (typeof item.label === 'string' ? item.label : item.label.label))
            );
            return completions.filter(
                (item) => !existingCompletionItems.has(typeof item.label === 'string' ? item.label : item.label.label)
            );
        } finally {
            if (
                this.pendingCompletionRequest.get(document)?.position.isEqual(position) &&
                this.pendingCompletionRequest.get(document)?.version === document.version
            ) {
                this.pendingCompletionRequest.delete(document);
            }
        }
    }
    async provideCompletionItemsFromKernel(
        document: TextDocument,
        position: Position,
        token: CancellationToken,
        context: CompletionContext
    ): Promise<CompletionItem[]> {
        if (token.isCancellationRequested || !this.kernel.session?.kernel) {
            return [];
        }
        const stopWatch = new StopWatch();
        const measures: TelemetryMeasures<Telemetry.KernelCodeCompletion> = {
            duration: 0,
            requestDuration: 0,
            completionItems: 0
        };
        const properties: TelemetryProperties<Telemetry.KernelCodeCompletion> = {
            kernelId: this.kernelId,
            kernelConnectionType: this.kernel.kernelConnectionMetadata.kind,
            kernelLanguage: getKernelLanguage(this.kernel),
            monacoLanguage: this.monacoLanguage,
            cancelled: false,
            kernelStatusBeforeRequest: this.kernel.status,
            completed: false,
            requestSent: false
        };
        // No point sending completions if we're not connected.
        // Even if we're busy restarting, then no point, by the time it starts, the user would have typed something else
        // Hence no point sending requests that would unnecessarily slow things down.
        if (this.kernel.status !== 'idle') {
            sendTelemetryEvent(Telemetry.KernelCodeCompletion, measures, properties);
            return [];
        }
        const code = document.getText();
        const cursor_pos = document.offsetAt(position);

        properties.requestSent = true;
        const kernelCompletions = await raceCancellation(
            token,
            this.kernel.session.kernel.requestComplete({
                code,
                cursor_pos
            })
        );
        traceVerbose(`Jupyter completion time: ${stopWatch.elapsedTime}`);
        properties.cancelled = token.isCancellationRequested;
        properties.completed = !token.isCancellationRequested;
        properties.kernelStatusAfterRequest = this.kernel.status;
        measures.requestDuration = token.isCancellationRequested ? 0 : stopWatch.elapsedTime;

        if (
            token.isCancellationRequested ||
            kernelCompletions?.content?.status !== 'ok' ||
            (kernelCompletions?.content?.matches?.length ?? 0) === 0
        ) {
            sendTelemetryEvent(Telemetry.KernelCodeCompletion, measures, properties);
            return [];
        }
        const result: INotebookCompletion = {
            matches: kernelCompletions.content.matches,
            cursor: {
                start: kernelCompletions.content.cursor_start,
                end: kernelCompletions.content.cursor_end
            },
            metadata: kernelCompletions.content.metadata
        };

        const experimentMatches = result.metadata ? result.metadata._jupyter_types_experimental : [];
        measures.completionItems = result.matches.length;
        sendTelemetryEvent(Telemetry.KernelCodeCompletion, measures, properties);

        // Check if we have more information about the completion items & whether its valid.
        // This will ensure that we don't regress (as long as all items are valid & we have the same number of completions items
        // then we should be able to use the experiment matches value)
        const dataToStore = {
            code,
            cursor: result.cursor,
            documentRef: new WeakRef(document),
            position: document.positionAt(result.cursor.start)
        };
        const range = new Range(document.positionAt(result.cursor.start), document.positionAt(result.cursor.end));
        let items: CompletionItem[] = [];
        if (
            Array.isArray(experimentMatches) &&
            experimentMatches.length >= result.matches.length &&
            experimentMatches.every((item) => item && typeof item.text === 'string')
        ) {
            // This works for Julia and Python kernels, haven't tested others.
            items = kernelCompletions.content.matches.map((label, index) => {
                const item = experimentMatches[index];
                const type = item.type ? mapJupyterKind.get(item.type) : CompletionItemKind.Field;

                const completionItem = new CompletionItem(label, type);

                if (typeof item.start === 'number' && typeof item.end === 'number') {
                    completionItem.range = new Range(document.positionAt(item.start), document.positionAt(item.end));
                } else {
                    completionItem.range = range;
                }
                completionItem.insertText = item.text;
                completionItem.sortText = generateSortString(index);
                if (
                    isPythonKernelConnection(this.kernel.kernelConnectionMetadata) &&
                    (label.startsWith('%') || label.startsWith('!'))
                ) {
                    // Update magics to have a much lower sort order than other strings.
                    // Also change things that start with our current word to eliminate the
                    // extra long label.
                    completionItem.sortText = `ZZZ${completionItem.sortText}`;
                }

                this.previousCompletionItems.set(completionItem, {
                    ...dataToStore,
                    originalCompletionItem: JSON.parse(JSON.stringify(completionItem)) // Used to resolve completion items.
                });
                return completionItem;
            });
        } else {
            items = result.matches.map((label, index) => {
                const completionItem = new CompletionItem(label);

                completionItem.range = range;
                completionItem.sortText = generateSortString(index);
                if (
                    isPythonKernelConnection(this.kernel.kernelConnectionMetadata) &&
                    (label.startsWith('%') || label.startsWith('!'))
                ) {
                    // Update magics to have a much lower sort order than other strings.
                    // Also change things that start with our current word to eliminate the
                    // extra long label.
                    completionItem.sortText = `ZZZ${completionItem.sortText}`;
                }
                this.previousCompletionItems.set(completionItem, {
                    ...dataToStore,
                    originalCompletionItem: completionItem
                });
                return completionItem;
            });
        }
        if (isPythonKernelConnection(this.kernel.kernelConnectionMetadata)) {
            return generatePythonCompletions(
                context.triggerCharacter,
                this.allowStringFilterForPython,
                items,
                document,
                position
            );
        }
        return items;
    }
    async resolveCompletionItem(item: CompletionItem, token: CancellationToken): Promise<CompletionItem> {
        if (!item.range || !this.kernel.session?.kernel) {
            // We always set a range in the completion item we send.
            return item;
        }
        const info = this.previousCompletionItems.get(item);
        if (!info) {
            return item;
        }
        const { documentRef, position, originalCompletionItem } = info;
        const document = documentRef.deref();
        if (!document) {
            return item;
        }
        return resolveCompletionItem(
            item,
            originalCompletionItem,
            token,
            this.kernel,
            this.kernelId,
            this.monacoLanguage,
            document,
            position,
            this.toDispose
        );
    }
}

class KernelSpecificCompletionProvider extends DisposableBase implements CompletionItemProvider {
    private cellCompletionProviders = new WeakMap<TextDocument, NotebookCellSpecificKernelCompletionProvider>();
    private completionItemsSent = new WeakMap<CompletionItem, NotebookCellSpecificKernelCompletionProvider>();
    private completionProvider?: IDisposable;
    private readonly monacoLanguage = getKernelLanguageAsMonacoLanguage(this.kernel);
    private readonly toDispose = this._register(new DisposableStore());
    private allowStringFilterForPython: boolean;

    constructor(
        private readonly kernel: IKernel,
        private readonly notebookEditorProvider: INotebookEditorProvider
    ) {
        super();
        this.registerCompletionProvider();
        this._register(
            workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration('jupyter.enableKernelCompletions')) {
                    if (!isKernelCompletionEnabled(this.kernel.notebook.uri)) {
                        this.completionProvider?.dispose();
                        this.completionProvider = undefined;
                        return;
                    } else if (!this.completionProvider) {
                        this.registerCompletionProvider();
                    }
                }
                if (
                    !e.affectsConfiguration('jupyter.completionTriggerCharacters') &&
                    !e.affectsConfiguration('jupyter.pythonCompletionTriggerCharacters')
                ) {
                    return;
                }
                this.completionProvider?.dispose();
                this.completionProvider = undefined;
                this.registerCompletionProvider();
            })
        );
    }
    private registerCompletionProvider() {
        if (!isKernelCompletionEnabled(this.kernel.notebook.uri)) {
            return;
        }

        const triggerCharacters = getCompletionTriggerCharacter(this.kernel);
        if (triggerCharacters.length === 0) {
            logHowToEnableKernelCompletion(this.kernel);
            return;
        }

        traceInfo(
            `Registering Kernel Completion Provider from kernel ${getDisplayNameOrNameOfKernelConnection(
                this.kernel.kernelConnectionMetadata
            )} for language ${this.monacoLanguage}`
        );
        this.allowStringFilterForPython = triggerCharacters.includes("'") || triggerCharacters.includes('"');
        this.completionProvider = languages.registerCompletionItemProvider(
            this.monacoLanguage,
            this,
            ...triggerCharacters
        );
        return;
    }
    override dispose() {
        super.dispose();
        this.completionProvider?.dispose();
    }
    async provideCompletionItems(
        document: TextDocument,
        position: Position,
        token: CancellationToken,
        _context: CompletionContext
    ): Promise<CompletionItem[]> {
        if (this.notebookEditorProvider.findAssociatedNotebookDocument(document.uri) !== this.kernel.notebook) {
            return [];
        }
        let provider = this.cellCompletionProviders.get(document);
        if (!provider) {
            const kernelId = await getTelemetrySafeHashedString(this.kernel.kernelConnectionMetadata.id);
            provider = new NotebookCellSpecificKernelCompletionProvider(
                kernelId,
                this.kernel,
                this.monacoLanguage,
                this.toDispose
            );
            this.cellCompletionProviders.set(document, provider);
        }
        provider.allowStringFilterForPython = this.allowStringFilterForPython;
        return provider.provideCompletionItems(document, position, token, _context).then((items) => {
            items.forEach((item) => this.completionItemsSent.set(item, provider!));
            return items;
        });
    }
    async resolveCompletionItem(item: CompletionItem, token: CancellationToken): Promise<CompletionItem> {
        const provider = this.completionItemsSent.get(item);
        return provider ? provider.resolveCompletionItem(item, token) : item;
    }
}

/**
 * This class implements a CompletionItemProvider for non-python kernels using the jupyter requestCompletions message.
 */
@injectable()
export class NonPythonKernelCompletionProvider extends DisposableBase implements IExtensionSyncActivationService {
    public readonly kernelCompletionProviders = new WeakMap<IKernel, KernelSpecificCompletionProvider>();
    constructor(@inject(IDisposableRegistry) disposables: IDisposableRegistry) {
        super();
        disposables.push(this);
    }
    public activate(): void {
        const kernelProvider = ServiceContainer.instance.get<IKernelProvider>(IKernelProvider);
        this._register(
            kernelProvider.onDidStartKernel(async (e) => {
                if (e.session?.kernel && isPythonKernelConnection(e.kernelConnectionMetadata)) {
                    /**
                     * Do not wait for completions,
                     * If the completions request crashes then we don't get a response for this request,
                     * Hence we end up waiting indefinitely.
                     * https://github.com/microsoft/vscode-jupyter/issues/9014
                     *
                     * We send this request to ensure the completion provider in the kernel has bee pre-warmed.
                     * This way things are faster when the user actually triggers a completion.
                     */
                    void e.session.kernel.requestComplete({ code: '__file__.', cursor_pos: 9 });
                }

                const experiment = ServiceContainer.instance.get<IExperimentService>(IExperimentService);
                const language = getKernelLanguageAsMonacoLanguage(e);
                if (!language) {
                    return;
                }
                if (
                    !experiment.inExperiment(Experiments.KernelCompletions) &&
                    language.toLowerCase() !== PYTHON_LANGUAGE.toLowerCase()
                ) {
                    return;
                }
                if (this.kernelCompletionProviders.has(e)) {
                    return;
                }
                const notebookProvider =
                    ServiceContainer.instance.get<INotebookEditorProvider>(INotebookEditorProvider);
                const completionProvider = this._register(new KernelSpecificCompletionProvider(e, notebookProvider));
                this.kernelCompletionProviders.set(e, completionProvider);
            })
        );
        this._register(
            kernelProvider.onDidDisposeKernel((e) => {
                this.kernelCompletionProviders.get(e)?.dispose();
            })
        );
    }
}

function getKernelLanguageAsMonacoLanguage(kernel: IKernel) {
    return translateKernelLanguageToMonaco(getKernelLanguage(kernel));
}
function getKernelLanguage(kernel: IKernel) {
    let kernelSpecLanguage: string | undefined = '';
    switch (kernel.kernelConnectionMetadata.kind) {
        case 'connectToLiveRemoteKernel':
            kernelSpecLanguage = kernel.kernelConnectionMetadata.kernelModel.language;
            break;
        case 'startUsingRemoteKernelSpec':
            kernelSpecLanguage = kernel.kernelConnectionMetadata.kernelSpec.language;
            break;
        case 'startUsingLocalKernelSpec':
            kernelSpecLanguage = kernel.kernelConnectionMetadata.kernelSpec.language;
            break;
        default:
            kernelSpecLanguage = kernel.kernelConnectionMetadata.kernelSpec.language;
            break;
    }

    return (kernelSpecLanguage || '').toLowerCase();
}

function isKernelCompletionEnabled(resource: Resource) {
    return workspace.getConfiguration('jupyter', resource).get<boolean>('enableKernelCompletions', false);
}

function getCompletionTriggerCharacter(kernel: IKernel) {
    if (isPythonKernelConnection(kernel.kernelConnectionMetadata)) {
        return workspace
            .getConfiguration('jupyter', kernel.notebook.uri)
            .get<string[]>('pythonCompletionTriggerCharacters', ['.', '%', "'", '"']);
    }

    const triggerCharacters = workspace
        .getConfiguration('jupyter', kernel.notebook.uri)
        .get<Record<string, string[]>>('completionTriggerCharacters');

    // Check if object, as this used to be a different setting a few years ago (when it was specific to Python).
    if (!triggerCharacters || typeof triggerCharacters !== 'object') {
        return [];
    }
    const kernelLanguage = getKernelLanguage(kernel);
    const monacoLanguage = getKernelLanguageAsMonacoLanguage(kernel);
    // Always use the kernel language first, then the monaco language.
    // Thats because kernel language could be something like `bash`
    // However there's no such language in vscode (monoca), and those get treated as `shellscript`
    // Such the kernel language `bash` ends up getting translated to the monaco language `shellscript`.
    // But we need to give preference to the language the users see in their kernelspecs and thats `bash`
    if (kernelLanguage in triggerCharacters) {
        // Possible a user still has some old setting.
        return Array.isArray(triggerCharacters[kernelLanguage]) ? triggerCharacters[kernelLanguage] : [];
    }
    if (monacoLanguage in triggerCharacters) {
        // Possible a user still has some old setting.
        return Array.isArray(triggerCharacters[monacoLanguage]) ? triggerCharacters[monacoLanguage] : [];
    }
    return [];
}

function logHowToEnableKernelCompletion(kernel: IKernel) {
    const kernelLanguage = getKernelLanguage(kernel);
    const monacoLanguage = getKernelLanguageAsMonacoLanguage(kernel);
    if (kernelLanguage.toLowerCase() === monacoLanguage.toLowerCase()) {
        traceWarning(
            l10n.t(
                `Kernel completions not enabled for '{0}'. \nTo enable Kernel completion for this language please add the following setting \njupyter.completionTriggerCharacters = {1}: [<List of characters that will trigger completions>]}. \nFor more information please see https://aka.ms/vscodeJupyterCompletion`,
                getDisplayNameOrNameOfKernelConnection(kernel.kernelConnectionMetadata),
                `{${kernelLanguage}`
            )
        );
    } else {
        traceWarning(
            l10n.t(
                `Kernel completions not enabled for '{0}'. \nTo enable Kernel completion for this language please add the following setting \njupyter.completionTriggerCharacters = {1}: [<List of characters that will trigger completions>]}. \n or the following: \njupyter.completionTriggerCharacters = {2}: [<List of characters that will trigger completions>]}. \nFor more information please see https://aka.ms/vscodeJupyterCompletion`,
                getDisplayNameOrNameOfKernelConnection(kernel.kernelConnectionMetadata),
                `{${kernelLanguage}`,
                `{${monacoLanguage}`
            )
        );
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

export function generatePythonCompletions(
    triggerCharacter: string | undefined,
    allowStringFilter: boolean,
    completions: CompletionItem[],
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
    result = result
        .map((r, i) => {
            let itemText = typeof r.label === 'string' ? r.label : r.label.label;
            let label = typeof r.label === 'string' ? r.label : r.label.label;
            if (label.startsWith('%') || label.startsWith('!')) {
                return {
                    ...r,
                    sortText: `ZZZ${r.sortText}`
                };
            }
            // Do nothing for paths and the like inside strings.
            if (insideString) {
                return r;
            }

            const wordIndex = word ? label.indexOf(word) : -1;
            let newLabel: string | undefined = undefined;
            let newText: string | undefined = undefined;
            let newRange: Range | { inserting: Range; replacing: Range } | undefined = undefined;

            // Two cases for filtering. We're at the '.', then the word we have is the beginning of the string.
            // Example, user typed 'df.' and label is 'df.PassengerId'. Word would be 'df.' in this case.
            if (word && wordDot && label.includes(word)) {
                newLabel = label.substring(label.indexOf(word) + (wordDot ? word.length : 0));
                newText = label.substring(label.indexOf(word) + word.length);
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
            // Example, user typed 'df.Pass' and label is 'df.PassengerId'. Word would be 'Pass' in this case.
            if (!newText && wordIndex > 0) {
                newLabel = label.substring(label.indexOf(word) + (wordDot ? word.length : 0));
                newText = label.substring(label.indexOf(word) + word.length);
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
                itemText = newText;
                r.insertText = newText;
                r.filterText = wordDot ? `.${newText}` : newText;
                r.range = newRange;
                r.sortText = generateSortString(i);
            }
            // If inside a string and ending with '/', then add a command to force a suggestion right after
            if (itemText.endsWith('/')) {
                return {
                    ...r,
                    command: {
                        command: 'editor.action.triggerSuggest',
                        title: ''
                    }
                };
            }
            // Sometimes we have items with spaces, and Jupyter escapes spaces with `\ `
            if (itemText.includes(' ')) {
                itemText = itemText.replace(/\\ /g, ' ');
                if (typeof r.label === 'string') {
                    r.label = r.label.replace(/\\ /g, ' ');
                } else {
                    r.label.label = r.label.label.replace(/\\ /g, ' ');
                }
            }
            // If not inside of a string, filter out file names (things that end with '/')
            if (!insideString) {
                if (!itemText.includes('.') && !itemText.endsWith('/')) {
                    return r;
                } else {
                    return undefined;
                }
            }

            return r;
        })
        .filter((r) => r !== undefined) as CompletionItem[];

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
