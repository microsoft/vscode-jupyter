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
import { Experiments, IDisposable, IDisposableRegistry, IExperimentService } from '../../platform/common/types';
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
import { sleep } from '../../platform/common/utils/async';
import { sendTelemetryEvent } from '../../telemetry';
import { getTelemetrySafeHashedString } from '../../platform/telemetry/helpers';
import { getDisplayNameOrNameOfKernelConnection } from '../../kernels/helpers';

class NotebookCellSpecificKernelCompletionProvider implements CompletionItemProvider {
    constructor(private readonly kernel: IKernel) {}
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
        const kernelCompletions = await raceCancellation(
            token,
            this.kernel.session.kernel.requestComplete({
                code: document.getText(),
                cursor_pos: document.offsetAt(position)
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
            return experimentMatches.map((item, index) => {
                return {
                    label: item.text,
                    range: new Range(document.positionAt(item.start), document.positionAt(item.end)),
                    kind: item.type ? mapJupyterKind.get(item.type) : CompletionItemKind.Field,
                    sortText: generateSortString(index)
                };
            });
        } else {
            return result.matches.map((item, index) => {
                return {
                    label: item,
                    sortText: generateSortString(index)
                };
            });
        }
    }
}

class KernelSpecificCompletionProvider extends DisposableBase implements CompletionItemProvider {
    private cellCompletionProviders = new WeakMap<TextDocument, NotebookCellSpecificKernelCompletionProvider>();
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
                if (!e.affectsConfiguration('jupyter.completionTriggerCharacters')) {
                    return;
                }
                this.completionProvider?.dispose();
                this.registerCompletionProvider();
            })
        );
    }
    private registerCompletionProvider() {
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
        return provider.provideCompletionItems(document, position, token, _context).finally(() => {
            sendTelemetryEvent(
                Telemetry.KernelCodeCompletion,
                { duration: stopWatch.elapsedTime },
                {
                    kernelId: this.kernelId,
                    kernelConnectionType: this.kernel.kernelConnectionMetadata.kind,
                    kernelLanguage: this.monacoLanguage,
                    cancelled: token.isCancellationRequested
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
        const experimentService = ServiceContainer.instance.get<IExperimentService>(IExperimentService);
        if (!experimentService.inExperiment(Experiments.KernelCompletions)) {
            return;
        }
        this._register(
            kernelProvider.onDidStartKernel(async (e) => {
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
    if (!kernelSpecLanguage || (kernelSpecLanguage || '').toLowerCase() === PYTHON_LANGUAGE.toLowerCase()) {
        return '';
    }

    return kernelSpecLanguage.toLowerCase();
}
