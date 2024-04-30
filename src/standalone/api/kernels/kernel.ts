// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
    l10n,
    CancellationToken,
    ProgressLocation,
    extensions,
    window,
    Disposable,
    workspace,
    NotebookDocument,
    Event,
    EventEmitter,
    NotebookCellOutput,
    type NotebookExecution,
    type NotebookController
} from 'vscode';
import { Kernel, KernelStatus, Output } from '../../../api';
import { ServiceContainer } from '../../../platform/ioc/container';
import { IKernel, IKernelProvider, INotebookKernelExecution } from '../../../kernels/types';
import { getDisplayNameOrNameOfKernelConnection, isPythonKernelConnection } from '../../../kernels/helpers';
import { IDisposable, IDisposableRegistry } from '../../../platform/common/types';
import { DisposableBase, ReferenceCollection, dispose } from '../../../platform/common/utils/lifecycle';
import { noop } from '../../../platform/common/utils/misc';
import { getTelemetrySafeHashedString } from '../../../platform/telemetry/helpers';
import { Telemetry, sendTelemetryEvent } from '../../../telemetry';
import { StopWatch } from '../../../platform/common/utils/stopWatch';
import { Deferred, createDeferred, sleep } from '../../../platform/common/utils/async';
import { once } from '../../../platform/common/utils/events';
import { traceVerbose } from '../../../platform/logging';
import { JVSC_EXTENSION_ID, POWER_TOYS_EXTENSION_ID, PYTHON_LANGUAGE } from '../../../platform/common/constants';
import { ChatMime, generatePythonCodeToInvokeCallback } from '../../../kernels/chat/generator';
import {
    isDisplayIdTrackedForExtension,
    trackDisplayDataForExtension
} from '../../../kernels/execution/extensionDisplayDataTracker';
import { getNotebookCellOutputMetadata } from '../../../kernels/execution/helpers';
import { registerChangeHandler, requestApiAccess } from './apiAccess';
import { IControllerRegistration } from '../../../notebooks/controllers/types';

class NotebookExecutionReferenceCollection extends ReferenceCollection<NotebookExecution> {
    private existingExecutions?: NotebookExecution;
    constructor(
        private readonly controller: NotebookController,
        private readonly notebook: NotebookDocument
    ) {
        super();
    }
    public dispose() {
        this.disposeExistingExecution();
    }

    protected override createReferencedObject(_key: string, ..._args: any[]): NotebookExecution {
        if (!this.existingExecutions) {
            this.existingExecutions = this.controller.createNotebookExecution(this.notebook);
            this.existingExecutions.start();
        }
        return this.existingExecutions;
    }
    protected override destroyReferencedObject(_key: string, _object: NotebookExecution): void {
        this.disposeExistingExecution();
    }
    private disposeExistingExecution() {
        try {
            this.existingExecutions?.end();
        } catch {
            //
        }
        this.existingExecutions = undefined;
    }
}
/**
 * Displays a progress indicator when 3rd party extensions execute code against a kernel.
 * The progress indicator is displayed only when the notebook is visible.
 *
 * We need this to notify users when execution takes place for:
 * 1. Transparency (they might not know that some code is being executed in a kernel)
 * 2. If users experience delays in kernel execution within notebooks, then they have an idea why this might be the case.
 */
class KernelExecutionProgressIndicator {
    private readonly controllerDisplayName: string;
    private readonly notebook?: NotebookDocument;
    private deferred?: Deferred<void>;
    private disposable?: IDisposable;
    private eventHandler: IDisposable;
    private readonly title: string;
    private displayInProgress?: boolean;
    private shouldDisplayProgress?: boolean;
    private static notificationsPerExtension = new WeakMap<IKernel, Set<string>>();
    private executionRefCountedDisposableFactory?: NotebookExecutionReferenceCollection;
    constructor(
        private readonly extensionId: string,
        private readonly kernel: IKernel,
        controller?: NotebookController
    ) {
        this.executionRefCountedDisposableFactory = controller
            ? new NotebookExecutionReferenceCollection(controller, kernel.notebook)
            : undefined;
        const extensionDisplayName = extensions.getExtension(extensionId)?.packageJSON?.displayName || extensionId;
        this.notebook = workspace.notebookDocuments.find((n) => n.uri.toString() === kernel.resourceUri?.toString());
        this.controllerDisplayName = getDisplayNameOrNameOfKernelConnection(kernel.kernelConnectionMetadata);
        this.title = l10n.t(`Executing code in {0} from {1}`, this.controllerDisplayName, extensionDisplayName);
        this.eventHandler = window.onDidChangeVisibleNotebookEditors(this.showProgressImpl, this);
    }
    dispose() {
        this.eventHandler.dispose();
        this.disposable?.dispose();
        this.executionRefCountedDisposableFactory?.dispose();
    }

    show() {
        const execution = this.executionRefCountedDisposableFactory?.acquire('');
        if (this.deferred && !this.deferred.completed) {
            const oldDeferred = this.deferred;
            this.deferred = createDeferred<void>();
            oldDeferred.resolve();
        } else {
            this.deferred = createDeferred<void>();
            this.showProgress().catch(noop);
        }
        return (this.disposable = new Disposable(() => {
            execution?.dispose();
            this.deferred?.resolve();
        }));
    }
    private async showProgress() {
        // Give a grace period of 1000ms to avoid displaying progress indicators too aggressively.
        // Clearly some extensions can take a while, see here https://github.com/microsoft/vscode-jupyter/issues/15613
        // More than 1s is too long,
        await sleep(1_000);
        if (!this.deferred || this.deferred.completed || this.displayInProgress) {
            return;
        }
        this.shouldDisplayProgress = true;
        await Promise.all([this.showProgressImpl(), this.waitUntilCompleted()]);
        this.shouldDisplayProgress = false;
    }
    private async showProgressImpl() {
        const notifiedExtensions =
            KernelExecutionProgressIndicator.notificationsPerExtension.get(this.kernel) || new Set();
        KernelExecutionProgressIndicator.notificationsPerExtension.set(this.kernel, notifiedExtensions);
        if (notifiedExtensions.has(this.extensionId)) {
            return;
        }
        notifiedExtensions.add(this.extensionId);
        if (!this.notebook || !this.shouldDisplayProgress) {
            return;
        }
        if (!window.visibleNotebookEditors.some((e) => e.notebook === this.notebook)) {
            return;
        }
        this.displayInProgress = true;
        await window.withProgress({ location: ProgressLocation.Notification, title: this.title }, async () =>
            this.waitUntilCompleted()
        );
        this.displayInProgress = false;
    }
    private async waitUntilCompleted() {
        let deferred = this.deferred;
        while (deferred && !deferred.completed) {
            await deferred.promise;
            // Possible the deferred was replaced.
            deferred = this.deferred;
        }
    }
}

/**
 * Design guidelines for separate kernel per extension.
 * Assume extension A & B use the same kernel and use this API.
 * Both can send code and so can the user via a notebook/iw.
 * Assume user executes code via notebook/iw and that is busy.
 * 1. Extension A executes code `1` against kernel,
 * 2. Laster extension A executes another block of code `2` against the kernel.
 * When executing code `2`, extension A would like to cancel the first request `1`.
 * However the kernel is busy running user code, extension A should not be aware of this knowledge.
 * We should keep track of this, and prevent Extension A from interrupting user code.
 * Once user code is done, then `1` will get picked up by the kernel and when we get an ack back from kernel
 * then we can interrupt the kernel.
 * Similarly, while `2` is busy executing, if Extension B comes in, they have to wait till `2` is done.
 * They have no way of knowing that `2` is busy executing via Extension A (or whether its user code).
 *
 * Basically Extensions should never be allowed to interrupt user code or other extensions code.
 * The Jupyter extension is the only one that can police this.
 *
 * Unfortunately what this means is we need a queue of requests, and the queue should apply to all extensions.
 * This way, when A cancels all requests and it was never sent to the kernel, all we need to do is
 * ensure those requests never get sent to the kernel.
 * While the requests from Extension B that are still in the queue can still get processed even after A cancels all of its requests.
 */
class WrappedKernelPerExtension extends DisposableBase implements Kernel {
    private readonly progress: KernelExecutionProgressIndicator;
    private readonly _api: Kernel;
    public readonly language: string;
    get status(): KernelStatus {
        return this.kernel.status;
    }
    private readonly _onDidChangeStatus = this._register(new EventEmitter<KernelStatus>());
    public get onDidChangeStatus(): Event<KernelStatus> {
        return this._onDidChangeStatus.event;
    }
    private readonly _onDidReceiveDisplayUpdate = this._register(new EventEmitter<NotebookCellOutput>());
    public get onDidReceiveDisplayUpdate(): Event<NotebookCellOutput> {
        return this._onDidReceiveDisplayUpdate.event;
    }
    private accessAllowed?: Promise<boolean>;
    constructor(
        private readonly extensionId: string,
        private readonly kernel: IKernel,
        private readonly execution: INotebookKernelExecution,
        controller?: NotebookController
    ) {
        super();
        this.progress = this._register(new KernelExecutionProgressIndicator(extensionId, kernel, controller));
        this._register(once(kernel.onDisposed)(() => this.progress.dispose()));
        this.language =
            kernel.kernelConnectionMetadata.kind === 'connectToLiveRemoteKernel'
                ? PYTHON_LANGUAGE
                : kernel.kernelConnectionMetadata.kernelSpec.language || PYTHON_LANGUAGE;
        this._register(this.kernel.onStatusChanged(() => this._onDidChangeStatus.fire(this.kernel.status)));
        this._register(
            execution.onDidReceiveDisplayUpdate((output) => {
                const session = this.kernel.session;
                const metadata = getNotebookCellOutputMetadata(output);
                if (
                    metadata?.outputType === 'display_data' &&
                    metadata?.transient?.display_id &&
                    session &&
                    isDisplayIdTrackedForExtension(this.extensionId, session, metadata?.transient?.display_id)
                ) {
                    this._onDidReceiveDisplayUpdate.fire(output);
                }
            })
        );
        // Plain object returned to 3rd party extensions that cannot be modified or messed with.
        const that = this;
        this._api = Object.freeze({
            language: this.language,
            get status() {
                return that.kernel.status;
            },
            onDidChangeStatus: that.onDidChangeStatus.bind(this),
            get onDidReceiveDisplayUpdate() {
                if (![JVSC_EXTENSION_ID, POWER_TOYS_EXTENSION_ID].includes(extensionId)) {
                    throw new Error(`Proposed API is not supported for extension ${extensionId}`);
                }

                return that.onDidReceiveDisplayUpdate.bind(this);
            },
            executeCode: (code: string, token: CancellationToken) => this.executeCode(code, token),
            executeChatCode: (
                code: string,
                handlers: Record<string, (data?: string) => Promise<string | undefined>>,
                token: CancellationToken
            ) => this.executeChatCode(code, handlers, token)
        });
    }
    static createApiKernel(
        extensionId: string,
        kernel: IKernel,
        execution: INotebookKernelExecution,
        controller?: NotebookController
    ) {
        const wrapper = new WrappedKernelPerExtension(extensionId, kernel, execution, controller);
        ServiceContainer.instance.get<IDisposableRegistry>(IDisposableRegistry).push(wrapper);
        return wrapper._api;
    }

    private async checkAccess() {
        if (this.extensionId === JVSC_EXTENSION_ID) {
            return;
        }
        if (!this.accessAllowed) {
            this.accessAllowed = this.doCheckAccess();
            this._register(registerChangeHandler(() => (this.accessAllowed = undefined)));
        }
        const accessAllowed = await this.accessAllowed;
        if (!accessAllowed) {
            throw new Error(l10n.t('Access to Jupyter Kernel has been revoked'));
        }
    }

    private async doCheckAccess() {
        // Check and prompt for access only if we know we have a kernel.
        const access = await requestApiAccess(this.extensionId);
        const accessAllowed = access.accessAllowed;
        sendTelemetryEvent(Telemetry.NewJupyterKernelsApiUsage, undefined, {
            extensionId: this.extensionId,
            pemUsed: 'getKernel',
            accessAllowed
        });
        return accessAllowed;
    }

    async *executeCode(code: string, token: CancellationToken): AsyncGenerator<Output, void, unknown> {
        await this.checkAccess();
        for await (const output of this.executeCodeInternal(code, undefined, token)) {
            yield output;
        }
    }
    async *executeChatCode(
        code: string,
        handlers: Record<string, (data?: string) => Promise<string | undefined>>,
        token: CancellationToken
    ): AsyncGenerator<Output, void, unknown> {
        await this.checkAccess();
        const allowedList = ['ms-vscode.dscopilot-agent', JVSC_EXTENSION_ID];
        if (!allowedList.includes(this.extensionId.toLowerCase())) {
            throw new Error(`Proposed API is not supported for extension ${this.extensionId}`);
        }
        if (!isPythonKernelConnection(this.kernel.kernelConnectionMetadata)) {
            throw new Error('Chat code execution is only supported for Python kernels');
        }
        for await (const output of this.executeCodeInternal(code, handlers, token)) {
            yield output;
        }
    }

    async *executeCodeInternal(
        code: string,
        handlers: Record<string, (...data: any[]) => Promise<any>> = {},
        token: CancellationToken
    ): AsyncGenerator<Output, void, unknown> {
        let completed = false;
        const measures = {
            executionCount: this.execution.executionCount,
            requestSentAfter: 0,
            requestAcknowledgedAfter: 0,
            cancelledAfter: 0,
            duration: 0
        };
        const properties = {
            kernelId: '',
            extensionId: this.extensionId,
            cancelled: false,
            requestSent: false,
            requestAcknowledged: false,
            cancelledBeforeRequestSent: false,
            cancelledBeforeRequestAcknowledged: false,
            mimeTypes: '',
            failed: false
        };
        const stopwatch = new StopWatch();
        const mimeTypes = new Set<string>();
        sendApiTelemetry(this.extensionId, this.kernel, 'executeCode', measures.executionCount).catch(noop);

        if (this.kernel.disposed) {
            properties.failed = true;
            sendApiExecTelemetry(this.kernel, measures, properties).catch(noop);
            throw new Error('Kernel is disposed');
        }
        if (!this.kernel.session?.kernel) {
            properties.failed = true;
            sendApiExecTelemetry(this.kernel, measures, properties).catch(noop);
            if (this.kernel.status === 'dead' || this.kernel.status === 'terminating') {
                throw new Error('Kernel is dead or terminating');
            }
            throw new Error('Kernel connection not available to execute 3rd party code');
        }

        const disposables: IDisposable[] = [];
        disposables.push({
            dispose: () => {
                measures.duration = stopwatch.elapsedTime;
                properties.mimeTypes = Array.from(mimeTypes).join(',');
                completed = true;
                sendApiExecTelemetry(this.kernel, measures, properties).catch(noop);
            }
        });
        const kernelExecution = ServiceContainer.instance
            .get<IKernelProvider>(IKernelProvider)
            .getKernelExecution(this.kernel);

        const events = {
            started: new EventEmitter<void>(),
            executionAcknowledged: new EventEmitter<void>()
        };

        events.started.event(
            () => {
                properties.requestSent = true;
                measures.requestSentAfter = stopwatch.elapsedTime;
                if (!token.isCancellationRequested && this.extensionId !== JVSC_EXTENSION_ID) {
                    disposables.push(this.progress.show());
                }
            },
            this,
            disposables
        );
        events.executionAcknowledged.event(
            () => {
                properties.requestAcknowledged = true;
                measures.requestAcknowledgedAfter = stopwatch.elapsedTime;
            },
            this,
            disposables
        );

        token.onCancellationRequested(
            () => {
                if (completed) {
                    return;
                }
                properties.cancelled = true;
                measures.cancelledAfter = stopwatch.elapsedTime;
                properties.cancelledBeforeRequestSent = !properties.requestSent;
                properties.cancelledBeforeRequestAcknowledged = !properties.requestAcknowledged;
                traceVerbose(`Code execution cancelled by extension ${this.extensionId}`);
            },
            this,
            disposables
        );

        try {
            for await (const output of kernelExecution.executeCode(code, this.extensionId, events, token)) {
                trackDisplayDataForExtension(this.extensionId, this.kernel.session, output);
                output.items.forEach((output) => mimeTypes.add(output.mime));
                if (handlers && hasChatOutput(output)) {
                    for await (const chatOutput of this.handleChatOutput(
                        output,
                        kernelExecution,
                        events,
                        mimeTypes,
                        handlers,
                        token
                    )) {
                        yield chatOutput;
                    }
                } else {
                    yield output;
                }
            }
        } finally {
            dispose(disposables);
        }
    }
    async *handleChatOutput(
        output: NotebookCellOutput,
        kernelExecution: INotebookKernelExecution,
        events: {
            started: EventEmitter<void>;
            executionAcknowledged: EventEmitter<void>;
        },
        mimeTypes: Set<string>,
        handlers: Record<string, (data?: string) => Promise<string | undefined>> = {},
        token: CancellationToken
    ): AsyncGenerator<Output, void, unknown> {
        const chatOutput = output.items.find((i) => i.mime === ChatMime);
        if (!chatOutput) {
            return;
        }
        type Metadata = {
            id: string;
            function: string;
            dataIsNone: boolean;
        };
        const metadata: Metadata = (output.metadata || {})['metadata'];
        const functionId = metadata.function;
        const id = metadata.id;
        const data = metadata.dataIsNone ? undefined : new TextDecoder().decode(chatOutput.data);
        const handler = handlers[functionId];
        if (!handler) {
            throw new Error(`Chat Function ${functionId} not found`);
        }
        const result = await handler(data);

        // Send the result back to the chat window.
        const code = generatePythonCodeToInvokeCallback(id, result);
        for await (const output of kernelExecution.executeCode(code, this.extensionId, events, token)) {
            output.items.forEach((output) => mimeTypes.add(output.mime));
            if (hasChatOutput(output)) {
                for await (const chatOutput of this.handleChatOutput(
                    output,
                    kernelExecution,
                    events,
                    mimeTypes,
                    handlers,
                    token
                )) {
                    yield chatOutput;
                }
            } else {
                yield output;
            }
        }
    }
}

function hasChatOutput(output: NotebookCellOutput) {
    return output.items.some((i) => i.mime === ChatMime);
}

async function sendApiTelemetry(extensionId: string, kernel: IKernel, pemUsed: keyof Kernel, executionCount: number) {
    const kernelId = await getTelemetrySafeHashedString(kernel.id);
    sendTelemetryEvent(Telemetry.NewJupyterKernelApiUsage, { executionCount }, { kernelId, pemUsed, extensionId });
}
async function sendApiExecTelemetry(
    kernel: IKernel,
    measures: {
        executionCount: number;
        requestSentAfter: number;
        requestAcknowledgedAfter: number;
        cancelledAfter: number;
        duration: number;
    },
    properties: {
        kernelId: string;
        extensionId: string;
        requestSent: boolean;
        cancelled: boolean;
        requestAcknowledged: boolean;
        cancelledBeforeRequestSent: boolean;
        cancelledBeforeRequestAcknowledged: boolean;
        mimeTypes: string;
        failed: boolean;
    }
) {
    properties.kernelId = await getTelemetrySafeHashedString(kernel.id);
    sendTelemetryEvent(Telemetry.NewJupyterKernelApiExecution, measures, properties);
}

export function createKernelApiForExtension(extensionId: string, kernel: IKernel) {
    const kernelProvider = ServiceContainer.instance.get<IKernelProvider>(IKernelProvider);
    const controller = ServiceContainer.instance
        .get<IControllerRegistration>(IControllerRegistration)
        .getSelected(kernel.notebook)?.controller;
    return WrappedKernelPerExtension.createApiKernel(
        extensionId,
        kernel,
        kernelProvider.getKernelExecution(kernel),
        controller
    );
}
