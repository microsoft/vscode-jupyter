// Copyright (c) Microsoft Corporation.
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
    l10n,
    languages,
    workspace
} from 'vscode';
import { raceCancellation } from '../../platform/common/cancellation';
import { traceInfo, traceVerbose, traceWarning } from '../../platform/logging';
import { IDisposable, IDisposableRegistry, Resource } from '../../platform/common/types';
import { StopWatch } from '../../platform/common/utils/stopWatch';
import { IKernelProvider, IKernel } from '../../kernels/types';
import { INotebookEditorProvider } from '../../notebooks/types';
import { mapJupyterKind } from './conversion';
import { PYTHON_LANGUAGE, Telemetry } from '../../platform/common/constants';
import { INotebookCompletion } from './types';
import { translateKernelLanguageToMonaco } from '../../platform/common/utils';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { ServiceContainer } from '../../platform/ioc/container';
import { DisposableBase } from '../../platform/common/utils/lifecycle';
import { generateSortString } from './pythonKernelCompletionProvider';
import { raceTimeout, sleep } from '../../platform/common/utils/async';
import { sendTelemetryEvent } from '../../telemetry';
import { getTelemetrySafeHashedString } from '../../platform/telemetry/helpers';
import { getDisplayNameOrNameOfKernelConnection } from '../../kernels/helpers';
import type { KernelMessage } from '@jupyterlab/services';
import { stripAnsi } from '../../platform/common/utils/regexp';

// Not all kernels support requestInspect method.
// E.g. deno does not support this, hence waiting for this to complete is poinless.
// As that results in a `loading...` method to appear against the completion item.
// If we have n consecutive attempts where the response never comes back in 1s,
// then we'll always ignore `requestInspect` method for this kernel.
const MAX_ATTEMPTS_BEFORE_IGNORING_RESOLVE_COMPLETION = 5;
const MAX_TIMEOUT_WAITING_FOR_RESOLVE_COMPLETION = 1_000;

const kernelIdsThatToNotSupportCompletionResolve = new Set<string>();

class NotebookCellSpecificKernelCompletionProvider implements CompletionItemProvider {
    private totalNumberOfTimeoutsWaitingForResolveCompletion = 0;
    constructor(private readonly kernel: IKernel) {}
    public get canResolveCompletionItem() {
        return this.totalNumberOfTimeoutsWaitingForResolveCompletion < MAX_ATTEMPTS_BEFORE_IGNORING_RESOLVE_COMPLETION;
    }

    private previousCompletionItems = new WeakMap<
        CompletionItem,
        { code: string; cursor: { start: number; end: number } }
    >();
    async provideCompletionItems(
        document: TextDocument,
        position: Position,
        token: CancellationToken,
        _context: CompletionContext
    ): Promise<CompletionItem[]> {
        // Wait for 100ms, as we do not want to flood the kernel with too many messages.
        // if after 100s, the token isn't cancelled, then send the request.
        const version = document.version;
        await sleep(100);
        if (token.isCancellationRequested || version !== document.version) {
            return [];
        }
        const stopWatch = new StopWatch();
        // No point sending completions if we're not connected.
        // Even if we're busy restarting, then no point, by the time it starts, the user would have typed something else
        // Hence no point sending requests that would unnecessarily slow things down.
        if (
            this.kernel.status === 'autorestarting' ||
            this.kernel.status === 'dead' ||
            this.kernel.status === 'restarting' ||
            this.kernel.status === 'terminating' ||
            this.kernel.status === 'unknown'
        ) {
            return [];
        }
        if (!this.kernel.session?.kernel) {
            return [];
        }
        const code = document.getText();
        const cursor_pos = document.offsetAt(position);
        const kernelCompletions = await raceCancellation(
            token,
            this.kernel.session.kernel.requestComplete({
                code,
                cursor_pos
            })
        );
        traceVerbose(`Jupyter completion time: ${stopWatch.elapsedTime}`);
        if (
            token.isCancellationRequested ||
            !kernelCompletions ||
            !kernelCompletions.content ||
            kernelCompletions.content.status !== 'ok'
        ) {
            return [];
        }
        if (kernelCompletions.content.matches.length === 0) {
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
        // Check if we have more information about the completion items & whether its valid.
        // This will ensure that we don't regress (as long as all items are valid & we have the same number of completions items
        // then we should be able to use the experiment matches value)
        const dataToStore = { code, cursor: result.cursor };
        if (
            Array.isArray(experimentMatches) &&
            experimentMatches.length >= result.matches.length &&
            experimentMatches.every(
                (item) =>
                    item &&
                    typeof item.start === 'number' &&
                    typeof item.end === 'number' &&
                    typeof item.text === 'string'
            )
        ) {
            return kernelCompletions.content.matches.map((label, index) => {
                const item = experimentMatches[index];
                const type = item.type ? mapJupyterKind.get(item.type) : CompletionItemKind.Field;

                const completionItem = new CompletionItem(label, type);

                completionItem.range = new Range(document.positionAt(item.start), document.positionAt(item.end));
                completionItem.insertText = item.text;
                completionItem.sortText = generateSortString(index);
                this.previousCompletionItems.set(completionItem, dataToStore);
                return completionItem;
            });
        } else {
            return result.matches.map((label, index) => {
                const completionItem = new CompletionItem(label);

                completionItem.range = new Range(
                    document.positionAt(result.cursor.start),
                    document.positionAt(result.cursor.end)
                );
                completionItem.sortText = generateSortString(index);
                this.previousCompletionItems.set(completionItem, dataToStore);
                return completionItem;
            });
        }
    }
    /**
     * Kernel provider will use the inspect request to lazy-load the content
     * for document panel.
     */
    async resolveCompletionItem(item: CompletionItem, token: CancellationToken): Promise<CompletionItem> {
        if (!item.range || !this.kernel.session?.kernel) {
            // We always set a range in the completion item we send.
            return item;
        }
        const info = this.previousCompletionItems.get(item);
        if (!info) {
            return item;
        }
        const { code, cursor } = info;
        const newCode = code.substring(0, cursor.start) + (item.insertText || item.label);
        const cursor_pos =
            cursor.start +
            (
                (typeof item.insertText === 'string' ? item.insertText : item.insertText?.value) ||
                (typeof item.label === 'string' ? item.label : item.label.label) ||
                ''
            ).length;
        const contents: KernelMessage.IInspectRequestMsg['content'] = {
            code: newCode,
            cursor_pos,
            detail_level: 0
        };
        const stopWatch = new StopWatch();
        const msg = await raceTimeout(
            MAX_TIMEOUT_WAITING_FOR_RESOLVE_COMPLETION,
            raceCancellation(token, this.kernel.session.kernel.requestInspect(contents))
        );
        if (token.isCancellationRequested) {
            return item;
        }
        if (!msg || msg.content.status !== 'ok' || !msg.content.found) {
            if (stopWatch.elapsedTime > MAX_TIMEOUT_WAITING_FOR_RESOLVE_COMPLETION) {
                this.totalNumberOfTimeoutsWaitingForResolveCompletion += 1;
            }
            return item;
        }
        item.documentation = stripAnsi(msg.content.data['text/plain'] as string);
        return item;
    }
}

class KernelSpecificCompletionProvider extends DisposableBase implements CompletionItemProvider {
    private cellCompletionProviders = new WeakMap<TextDocument, NotebookCellSpecificKernelCompletionProvider>();
    private completionItemsSent = new WeakMap<
        CompletionItem,
        { duration: number; provider: NotebookCellSpecificKernelCompletionProvider }
    >();
    private readonly monacoLanguage: string;
    private readonly kernelLanguage: string;
    private completionProvider?: IDisposable;
    constructor(
        private readonly kernelId: string,
        private readonly kernel: IKernel,
        private readonly notebookEditorProvider: INotebookEditorProvider
    ) {
        super();
        this.kernelLanguage = getKernelLanguage(kernel);
        this.monacoLanguage = getKernelLanguageAsMonacoLanguage(kernel);
        this.registerCompletionProvider();
        this._register(
            workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration('jupyter.enableKernelCompletions')) {
                    if (!isKernelCompletionEnabled(this.kernel.notebook.uri)) {
                        this.completionProvider?.dispose();
                        return;
                    }
                }
                if (!e.affectsConfiguration('jupyter.completionTriggerCharacters')) {
                    return;
                }
                this.completionProvider?.dispose();
                this.registerCompletionProvider();
            })
        );
    }
    private registerCompletionProvider() {
        if (!isKernelCompletionEnabled(this.kernel.notebook.uri)) {
            return;
        }

        const triggerCharacters = this.getCompletionTriggerCharacter();
        if (triggerCharacters.length === 0) {
            if (this.kernelLanguage.toLowerCase() === this.monacoLanguage.toLowerCase()) {
                traceWarning(
                    l10n.t(
                        `Kernel completions not enabled for '{0}'. \nTo enable Kernel completion for this language please add the following setting \njupyter.completionTriggerCharacters = {1}: [<List of characters that will trigger completions>]}. \nFor more information please see https://aka.ms/vscodeJupyterCompletion`,
                        getDisplayNameOrNameOfKernelConnection(this.kernel.kernelConnectionMetadata),
                        `{${this.kernelLanguage}`
                    )
                );
            } else {
                traceWarning(
                    l10n.t(
                        `Kernel completions not enabled for '{0}'. \nTo enable Kernel completion for this language please add the following setting \njupyter.completionTriggerCharacters = {1}: [<List of characters that will trigger completions>]}. \n or the following: \njupyter.completionTriggerCharacters = {2}: [<List of characters that will trigger completions>]}. \nFor more information please see https://aka.ms/vscodeJupyterCompletion`,
                        getDisplayNameOrNameOfKernelConnection(this.kernel.kernelConnectionMetadata),
                        `{${this.kernelLanguage}`,
                        `{${this.monacoLanguage}`
                    )
                );
            }
            return;
        }
        traceInfo(
            `Registering Kernel Completion Provider from kernel ${getDisplayNameOrNameOfKernelConnection(
                this.kernel.kernelConnectionMetadata
            )} for language ${this.monacoLanguage}`
        );
        this.completionProvider = languages.registerCompletionItemProvider(
            this.monacoLanguage,
            this,
            ...triggerCharacters
        );
    }
    private getCompletionTriggerCharacter() {
        const triggerCharacters = workspace
            .getConfiguration('jupyter', this.kernel.notebook.uri)
            .get<Record<string, string[]>>('completionTriggerCharacters');

        // Check if object, as this used to be a different setting a few years ago (when it was specific to Python).
        if (!triggerCharacters || typeof triggerCharacters !== 'object') {
            return [];
        }
        // Always use the kernel language first, then the monaco language.
        // Thats because kernel language could be something like `bash`
        // However there's no such language in vscode (monoca), and those get treated as `shellscript`
        // Such the kernel language `bash` ends up getting translated to the monaco language `shellscript`.
        // But we need to give preference to the language the users see in their kernelspecs and thats `bash`
        if (this.kernelLanguage in triggerCharacters) {
            // Possible a user still has some old setting.
            return Array.isArray(triggerCharacters[this.kernelLanguage]) ? triggerCharacters[this.kernelLanguage] : [];
        }
        if (this.monacoLanguage in triggerCharacters) {
            // Possible a user still has some old setting.
            return Array.isArray(triggerCharacters[this.monacoLanguage]) ? triggerCharacters[this.monacoLanguage] : [];
        }
        return [];
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
            provider = new NotebookCellSpecificKernelCompletionProvider(this.kernel);
            this.cellCompletionProviders.set(document, provider);
        }
        const stopWatch = new StopWatch();
        const items = await provider.provideCompletionItems(document, position, token, _context);
        const duration = stopWatch.elapsedTime;
        sendTelemetryEvent(
            Telemetry.KernelCodeCompletion,
            { duration, resolveDuration: 0 },
            {
                kernelId: this.kernelId,
                kernelConnectionType: this.kernel.kernelConnectionMetadata.kind,
                kernelLanguage: this.monacoLanguage,
                cancelled: token.isCancellationRequested
            }
        );
        const data = { duration, provider };
        items.forEach((item) => this.completionItemsSent.set(item, data));
        return items;
    }
    async resolveCompletionItem(item: CompletionItem, token: CancellationToken): Promise<CompletionItem> {
        const info = this.completionItemsSent.get(item);
        if (!info || kernelIdsThatToNotSupportCompletionResolve.has(this.kernelId)) {
            return item;
        }
        const { duration, provider } = info;
        if (!provider.canResolveCompletionItem) {
            // Never send the telemetry again and do not try in this session.
            kernelIdsThatToNotSupportCompletionResolve.add(this.kernelId);
            sendTelemetryEvent(Telemetry.KernelCodeCompletionCannotResolve, undefined, {
                kernelId: this.kernelId,
                kernelConnectionType: this.kernel.kernelConnectionMetadata.kind,
                kernelLanguage: this.monacoLanguage
            });
            return item;
        }

        const stopWatch = new StopWatch();
        return provider.resolveCompletionItem(item, token).finally(() => {
            sendTelemetryEvent(
                Telemetry.KernelCodeCompletion,
                { duration, resolveDuration: stopWatch.elapsedTime },
                {
                    kernelId: this.kernelId,
                    kernelConnectionType: this.kernel.kernelConnectionMetadata.kind,
                    kernelLanguage: this.monacoLanguage,
                    cancelled: token.isCancellationRequested,
                    resolved: true
                }
            );
        });
    }
}

/**
 * This class implements a CompletionItemProvider for non-python kernels using the jupyter requestCompletions message.
 */
@injectable()
export class NonPythonKernelCompletionProvider extends DisposableBase implements IExtensionSyncActivationService {
    private readonly kernelCompletionProviders = new WeakMap<IKernel, KernelSpecificCompletionProvider>();
    constructor(@inject(IDisposableRegistry) disposables: IDisposableRegistry) {
        super();
        disposables.push(this);
    }
    public activate(): void {
        const kernelProvider = ServiceContainer.instance.get<IKernelProvider>(IKernelProvider);
        this._register(
            kernelProvider.onDidStartKernel(async (e) => {
                if (!isKernelCompletionEnabled(e.notebook.uri)) {
                    return;
                }
                const kernelId = await getTelemetrySafeHashedString(e.kernelConnectionMetadata.id);
                const language = getKernelLanguageAsMonacoLanguage(e);
                if (!language || language.toLowerCase() === PYTHON_LANGUAGE.toLowerCase()) {
                    return;
                }
                if (this.kernelCompletionProviders.has(e)) {
                    return;
                }
                const notebookProvider =
                    ServiceContainer.instance.get<INotebookEditorProvider>(INotebookEditorProvider);
                const completionProvider = this._register(
                    new KernelSpecificCompletionProvider(kernelId, e, notebookProvider)
                );
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
