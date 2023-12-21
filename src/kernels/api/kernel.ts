// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

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
    EventEmitter
} from 'vscode';
import { Kernel, KernelStatus, Output } from '../../api';
import { ServiceContainer } from '../../platform/ioc/container';
import { IKernel, IKernelProvider, INotebookKernelExecution } from '../types';
import { getDisplayNameOrNameOfKernelConnection } from '../helpers';
import { IDisposable, IDisposableRegistry } from '../../platform/common/types';
import { DisposableBase, dispose } from '../../platform/common/utils/lifecycle';
import { noop } from '../../platform/common/utils/misc';
import { getTelemetrySafeHashedString } from '../../platform/telemetry/helpers';
import { Telemetry, sendTelemetryEvent } from '../../telemetry';
import { StopWatch } from '../../platform/common/utils/stopWatch';
import { Deferred, createDeferred, sleep } from '../../platform/common/utils/async';
import { once } from '../../platform/common/utils/events';
import { traceVerbose } from '../../platform/logging';
import { PYTHON_LANGUAGE } from '../../platform/common/constants';

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
    constructor(extensionId: string, kernel: IKernel) {
        const extensionDisplayName = extensions.getExtension(extensionId)?.packageJSON?.displayName || extensionId;
        this.notebook = workspace.notebookDocuments.find((n) => n.uri.toString() === kernel.resourceUri?.toString());
        this.controllerDisplayName = getDisplayNameOrNameOfKernelConnection(kernel.kernelConnectionMetadata);
        this.title = l10n.t(`Executing code in {0} from {1}`, this.controllerDisplayName, extensionDisplayName);
        this.eventHandler = window.onDidChangeVisibleNotebookEditors(this.showProgressImpl, this);
    }
    dispose() {
        this.eventHandler.dispose();
        this.disposable?.dispose();
    }

    show() {
        if (this.deferred && !this.deferred.completed) {
            const oldDeferred = this.deferred;
            this.deferred = createDeferred<void>();
            oldDeferred.resolve();
            return (this.disposable = new Disposable(() => this.deferred?.resolve()));
        }

        this.deferred = createDeferred<void>();
        this.showProgress().catch(noop);
        return (this.disposable = new Disposable(() => this.deferred?.resolve()));
    }
    private async showProgress() {
        // Give a grace period of 500ms to avoid displaying progress indicators too aggressively.
        await sleep(500);
        if (!this.deferred || this.deferred.completed || this.displayInProgress) {
            return;
        }
        this.shouldDisplayProgress = true;
        await Promise.all([this.showProgressImpl(), this.waitUntilCompleted()]);
        this.shouldDisplayProgress = false;
    }
    private async showProgressImpl() {
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
    private previousProgress?: IDisposable;
    private readonly _api: Kernel;
    public readonly language: string;
    get status(): KernelStatus {
        return this.kernel.status;
    }
    private readonly _onDidChangeStatus = this._register(new EventEmitter<KernelStatus>());
    public get onDidChangeStatus(): Event<KernelStatus> {
        return this._onDidChangeStatus.event;
    }
    constructor(
        private readonly extensionId: string,
        private readonly kernel: IKernel,
        private readonly execution: INotebookKernelExecution,
        private readonly kernelAccess: { accessAllowed: boolean }
    ) {
        super();
        this.progress = this._register(new KernelExecutionProgressIndicator(extensionId, kernel));
        this._register(once(kernel.onDisposed)(() => this.progress.dispose()));
        this.language =
            kernel.kernelConnectionMetadata.kind === 'connectToLiveRemoteKernel'
                ? PYTHON_LANGUAGE
                : kernel.kernelConnectionMetadata.kernelSpec.language || PYTHON_LANGUAGE;
        this._register(this.kernel.onStatusChanged(() => this._onDidChangeStatus.fire(this.kernel.status), this));
        // Plain object returned to 3rd party extensions that cannot be modified or messed with.
        const that = this;
        this._api = Object.freeze({
            language: this.language,
            get status() {
                return that.kernel.status;
            },
            onDidChangeStatus: that.onDidChangeStatus,
            executeCode: (code: string, token: CancellationToken) => this.executeCode(code, token)
        });
    }
    static createApiKernel(
        extensionId: string,
        kernel: IKernel,
        execution: INotebookKernelExecution,
        kernelAccess: { accessAllowed: boolean }
    ) {
        const wrapper = new WrappedKernelPerExtension(extensionId, kernel, execution, kernelAccess);
        ServiceContainer.instance.get<IDisposableRegistry>(IDisposableRegistry).push(wrapper);
        return wrapper._api;
    }

    async *executeCode(code: string, token: CancellationToken): AsyncGenerator<Output, void, unknown> {
        if (!this.kernelAccess.accessAllowed) {
            throw new Error(l10n.t('Access to Jupyter Kernel has been revoked'));
        }
        this.previousProgress?.dispose();
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
                if (!token.isCancellationRequested) {
                    const progress = (this.previousProgress = this.progress.show());
                    disposables.push(progress);
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
                output.items.forEach((output) => mimeTypes.add(output.mime));
                yield output;
            }
        } finally {
            dispose(disposables);
        }
    }
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

export function createKernelApiForExtension(
    extensionId: string,
    kernel: IKernel,
    kernelAccess: { accessAllowed: boolean }
) {
    const kernelProvider = ServiceContainer.instance.get<IKernelProvider>(IKernelProvider);
    return WrappedKernelPerExtension.createApiKernel(
        extensionId,
        kernel,
        kernelProvider.getKernelExecution(kernel),
        kernelAccess
    );
}
