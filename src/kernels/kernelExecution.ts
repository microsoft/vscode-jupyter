// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { IOutput } from '@jupyterlab/nbformat';
import {
    NotebookCell,
    NotebookCellKind,
    EventEmitter,
    notebooks,
    NotebookCellExecutionState,
    NotebookDocument,
    workspace,
    CancellationToken,
    NotebookCellOutput
} from 'vscode';
import { getDisplayPath } from '../platform/common/platform/fs-paths';
import { IDisposable, IExtensionContext } from '../platform/common/types';
import { traceInfo, traceVerbose } from '../platform/logging';
import { Telemetry } from '../telemetry';
import { DisplayOptions } from './displayOptions';
import { CellExecutionFactory } from './execution/cellExecution';
import { CellExecutionMessageHandlerService } from './execution/cellExecutionMessageHandlerService';
import { CellExecutionQueue } from './execution/cellExecutionQueue';
import { cellOutputToVSCCellOutput, traceCellMessage } from './execution/helpers';
import { executeSilently } from './helpers';
import { initializeInteractiveOrNotebookTelemetryBasedOnUserAction } from './telemetry/helper';
import { sendKernelTelemetryEvent } from './telemetry/sendKernelTelemetryEvent';
import {
    IKernel,
    IKernelSession,
    INotebookKernelExecution,
    ITracebackFormatter,
    ResumeCellExecutionInformation
} from './types';
import { SessionDisposedError } from '../platform/errors/sessionDisposedError';
import { StopWatch } from '../platform/common/utils/stopWatch';
import { noop } from '../platform/common/utils/misc';
// Disable ES Lint rule for now, as this is only for telemetry (hence not a layer breaking change)
import {
    pendingInspectRequests
    // eslint-disable-next-line import/no-restricted-paths
} from '../standalone/intellisense/resolveCompletionItem';
import { createDeferred, createDeferredFromPromise } from '../platform/common/utils/async';
import { dispose } from '../platform/common/utils/lifecycle';
import { JVSC_EXTENSION_ID } from '../platform/common/constants';
import type { IMessage } from '@jupyterlab/services/lib/kernel/messages';
import type { KernelMessage } from '@jupyterlab/services';
import type * as nbformat from '@jupyterlab/nbformat';
import {
    isDisplayIdTrackedForAnExtension,
    trackDisplayDataForExtension
} from './execution/extensionDisplayDataTracker';

/**
 * Everything in this classes gets disposed via the `onWillCancel` hook.
 */
export class NotebookKernelExecution implements INotebookKernelExecution {
    private readonly disposables: IDisposable[] = [];
    get executionCount(): number {
        return this._visibleExecutionCount;
    }
    private _visibleExecutionCount = 0;
    private readonly _onPreExecute = new EventEmitter<NotebookCell>();
    public readonly onPreExecute = this._onPreExecute.event;
    private readonly _onPostExecute = new EventEmitter<NotebookCell>();
    public readonly onPostExecute = this._onPostExecute.event;
    private readonly documentExecutions = new WeakMap<NotebookDocument, CellExecutionQueue>();
    private readonly executionFactory: CellExecutionFactory;
    private readonly _onDidRecieveDisplayUpdate = new EventEmitter<NotebookCellOutput>();
    public readonly onDidRecieveDisplayUpdate = this._onDidRecieveDisplayUpdate.event;
    private readonly hookedSesions = new WeakSet<IKernelSession>();

    constructor(
        private readonly kernel: IKernel,
        context: IExtensionContext,
        formatters: ITracebackFormatter[],
        private readonly notebook: NotebookDocument
    ) {
        const requestListener = new CellExecutionMessageHandlerService(
            kernel.controller,
            context,
            formatters,
            notebook
        );
        this.disposables.push(requestListener);
        this.executionFactory = new CellExecutionFactory(kernel.controller, requestListener);

        notebooks.onDidChangeNotebookCellExecutionState((e) => {
            if (e.cell.notebook === kernel.notebook) {
                if (e.state === NotebookCellExecutionState.Idle && e.cell.executionSummary?.executionOrder) {
                    this._visibleExecutionCount = Math.max(
                        this._visibleExecutionCount,
                        e.cell.executionSummary.executionOrder
                    );
                }
            }
        });
        kernel.onRestarted(() => (this._visibleExecutionCount = 0), this, this.disposables);
        kernel.onStarted(() => (this._visibleExecutionCount = 0), this, this.disposables);
        kernel.addHook('willInterrupt', this.onWillInterrupt, this, this.disposables);
        kernel.addHook('willCancel', this.onWillCancel, this, this.disposables);
        kernel.addHook('willRestart', (sessionPromise) => this.onWillRestart(sessionPromise), this, this.disposables);
        kernel.onStatusChanged(this.hookupIOPubHandler, this, this.disposables);
        kernel.onRestarted(this.hookupIOPubHandler, this, this.disposables);
        this.hookupIOPubHandler();
        this.disposables.push(this._onPreExecute);
    }
    private hookupIOPubHandler() {
        const session = this.kernel.session;
        if (!session || this.hookedSesions.has(session)) {
            return;
        }
        this.hookedSesions.add(session);
        const handler = (_: unknown, msg: IMessage) => {
            if (msg.header.msg_type !== 'update_display_data' && msg.header.msg_type !== 'display_data') {
                return;
            }
            const iopubMsg = msg as KernelMessage.IUpdateDisplayDataMsg | KernelMessage.IDisplayDataMsg;
            const displayId = iopubMsg.content.transient?.display_id;
            if (!displayId || !isDisplayIdTrackedForAnExtension(session, displayId)) {
                return;
            }
            const newOutput = cellOutputToVSCCellOutput({
                output_type: 'display_data',
                data: iopubMsg.content.data,
                metadata: iopubMsg.content.metadata,
                transient: iopubMsg.content.transient
            } as nbformat.IDisplayData);
            this._onDidRecieveDisplayUpdate.fire(newOutput);
        };
        session.iopubMessage.connect(handler);
        this.disposables.push({
            dispose: () => {
                session?.iopubMessage.disconnect(handler);
            }
        });
    }
    public get pendingCells(): readonly NotebookCell[] {
        return this.documentExecutions.get(this.notebook)?.queue || [];
    }

    public async resumeCellExecution(cell: NotebookCell, info: ResumeCellExecutionInformation): Promise<void> {
        traceCellMessage(
            cell,
            `NotebookKernelExecution.resumeCellExecution (start), ${getDisplayPath(cell.notebook.uri)}`
        );
        if (cell.kind == NotebookCellKind.Markup) {
            return;
        }

        await initializeInteractiveOrNotebookTelemetryBasedOnUserAction(
            this.kernel.resourceUri,
            this.kernel.kernelConnectionMetadata
        );
        sendKernelTelemetryEvent(this.kernel.resourceUri, Telemetry.ResumeCellExecution);
        const sessionPromise = this.kernel.start(new DisplayOptions(false));
        const executionQueue = this.getOrCreateCellExecutionQueue(cell.notebook, sessionPromise);
        executionQueue.resumeCell(cell, info);
        const success = await executionQueue
            .waitForCompletion(cell)
            .then(() => true)
            .catch(() => false);

        traceCellMessage(
            cell,
            `NotebookKernelExecution.resumeCellExecution (completed), ${getDisplayPath(cell.notebook.uri)}`
        );
        traceVerbose(`Cell ${cell.index} executed ${success ? 'successfully' : 'with an error'}`);
    }
    public async executeCell(cell: NotebookCell, codeOverride?: string | undefined): Promise<void> {
        traceCellMessage(cell, `NotebookKernelExecution.executeCell (1), ${getDisplayPath(cell.notebook.uri)}`);
        const pendingInspectRequestsBefore = this.kernel.session?.kernel
            ? pendingInspectRequests.get(this.kernel.session.kernel)?.count || 0
            : 0;
        const stopWatch = new StopWatch();
        if (cell.kind == NotebookCellKind.Markup) {
            return;
        }

        traceCellMessage(cell, `NotebookKernelExecution.executeCell, ${getDisplayPath(cell.notebook.uri)}`);
        await initializeInteractiveOrNotebookTelemetryBasedOnUserAction(
            this.kernel.resourceUri,
            this.kernel.kernelConnectionMetadata
        );
        const sessionPromise = this.kernel.start(new DisplayOptions(false));

        // If we're restarting, wait for it to finish
        await this.kernel.restarting;

        traceCellMessage(cell, `NotebookKernelExecution.executeCell (2), ${getDisplayPath(cell.notebook.uri)}`);
        const executionQueue = this.getOrCreateCellExecutionQueue(cell.notebook, sessionPromise);
        executionQueue.queueCell(cell, codeOverride);
        let success = true;
        try {
            await executionQueue.waitForCompletion(cell);
        } catch (ex) {
            success = false;
            throw ex;
        } finally {
            traceCellMessage(
                cell,
                `NotebookKernelExecution.executeCell completed (3), ${getDisplayPath(cell.notebook.uri)}`
            );
            traceVerbose(`Cell ${cell.index} executed ${success ? 'successfully' : 'with an error'}`);
            const pendingInspectRequestsAfter = this.kernel.session?.kernel
                ? pendingInspectRequests.get(this.kernel.session.kernel)?.count || 0
                : 0;
            sendKernelTelemetryEvent(this.kernel.resourceUri, Telemetry.ExecuteCell, {
                duration: stopWatch.elapsedTime,
                pendingInspectRequestsAfter,
                pendingInspectRequestsBefore
            });
        }
    }
    public async *executeCode(
        code: string,
        extensionId: string,
        events: {
            started: EventEmitter<void>;
            executionAcknowledged: EventEmitter<void>;
        },
        token: CancellationToken
    ): AsyncGenerator<NotebookCellOutput, void, unknown> {
        const stopWatch = new StopWatch();
        await initializeInteractiveOrNotebookTelemetryBasedOnUserAction(
            this.kernel.resourceUri,
            this.kernel.kernelConnectionMetadata
        );
        const sessionPromise = this.kernel.start(new DisplayOptions(false));

        // If we're restarting, wait for it to finish
        await this.kernel.restarting;

        const executionQueue = this.getOrCreateCellExecutionQueue(this.notebook, sessionPromise);
        const result = executionQueue.queueCode(code, extensionId, token);
        if (extensionId !== JVSC_EXTENSION_ID) {
            traceVerbose(
                `Queue code ${result.executionId} from ${extensionId} after ${stopWatch.elapsedTime}ms:\n${code}`
            );
        }
        let completed = false;
        const disposables: IDisposable[] = [];
        result.result
            .finally(() => {
                completed = true;
                !token.isCancellationRequested &&
                    traceInfo(`Execution of code ${result.executionId} completed in ${stopWatch.elapsedTime}ms`);
                if (extensionId !== JVSC_EXTENSION_ID) {
                    sendKernelTelemetryEvent(
                        this.kernel.resourceUri,
                        Telemetry.ExecuteCode,
                        { duration: stopWatch.elapsedTime },
                        { extensionId }
                    );
                }
                dispose(disposables);
            })
            .catch(noop);
        const done = createDeferredFromPromise(result.result);
        const outputs: NotebookCellOutput[] = [];
        let outputsReceived = createDeferred<void>();
        disposables.push(result.onRequestSent(() => events.started.fire()));
        disposables.push(result.onRequestAcknowledged(() => events.executionAcknowledged.fire()));
        result.onDidEmitOutput(
            (e) => {
                outputs.push(e);
                outputsReceived.resolve();
                outputsReceived = createDeferred<void>();
            },
            this,
            disposables
        );
        token.onCancellationRequested(
            () => {
                if (completed) {
                    return;
                }
                traceVerbose(`Code execution cancelled by extension ${extensionId}`);
            },
            this,
            disposables
        );
        while (true) {
            await Promise.race([outputsReceived.promise, done.promise]);
            if (completed) {
                outputsReceived = createDeferred<void>();
            }
            const session = this.kernel.session;
            while (outputs.length) {
                const output = outputs.shift()!;
                if (session) {
                    trackDisplayDataForExtension(extensionId, session, output);
                }
                yield output;
            }
            if (done.completed) {
                break;
            }
        }
    }
    executeHidden(code: string): Promise<IOutput[]> {
        const sessionPromise = this.kernel.start();
        return sessionPromise.then((session) =>
            session.kernel ? executeSilently(session.kernel, code) : Promise.reject(new SessionDisposedError())
        );
    }
    private async onWillInterrupt() {
        const executionQueue = this.documentExecutions.get(this.notebook);
        if (!executionQueue && this.kernel.kernelConnectionMetadata.kind !== 'connectToLiveRemoteKernel') {
            return;
        }
        traceInfo('Interrupt kernel execution');
        // First cancel all the cells & then wait for them to complete.
        // Both must happen together, we cannot just wait for cells to complete, as its possible
        // that cell1 has started & cell2 has been queued. If Cell1 completes, then Cell2 will start.
        // What we want is, if Cell1 completes then Cell2 should not start (it must be cancelled before hand).
        if (executionQueue) {
            await executionQueue.cancel();
            await executionQueue.waitForCompletion().catch(noop);
        }
    }
    private async onWillCancel() {
        const executionQueue = this.documentExecutions.get(this.notebook);
        if (executionQueue) {
            await executionQueue.cancel(true);
        }
    }
    /**
     * Restarts the kernel
     * If we don't have a kernel (Jupyter Session) available, then just abort all of the cell executions.
     */
    private async onWillRestart(sessionPromise?: Promise<IKernelSession>) {
        const executionQueue = this.documentExecutions.get(this.notebook);
        // Possible we don't have a notebook.
        const session = sessionPromise ? await sessionPromise.catch(() => undefined) : undefined;
        // First cancel all the cells & then wait for them to complete.
        // Both must happen together, we cannot just wait for cells to complete, as its possible
        // that cell1 has started & cell2 has been queued. If Cell1 completes, then Cell2 will start.
        // What we want is, if Cell1 completes then Cell2 should not start (it must be cancelled before hand).
        const pendingCells = executionQueue
            ? executionQueue.cancel(true).then(() => executionQueue.waitForCompletion().catch(noop))
            : Promise.resolve();

        if (!session) {
            traceInfo('No kernel session to interrupt');
            await pendingCells;
        }
    }
    private getOrCreateCellExecutionQueue(document: NotebookDocument, sessionPromise: Promise<IKernelSession>) {
        const existingExecutionQueue = this.documentExecutions.get(document);
        // Re-use the existing Queue if it can be used.
        if (existingExecutionQueue && !existingExecutionQueue.isEmpty && !existingExecutionQueue.failed) {
            return existingExecutionQueue;
        }

        const newCellExecutionQueue = new CellExecutionQueue(
            sessionPromise,
            this.executionFactory,
            this.kernel.kernelConnectionMetadata,
            this.kernel.resourceUri
        );
        this.disposables.push(newCellExecutionQueue);

        // If the document is closed (user or on CI), then just stop handling the UI updates & cancel cell execution queue.
        workspace.onDidCloseNotebookDocument(
            async (e: NotebookDocument) => {
                if (e === document) {
                    traceVerbose(`Cancel executions after closing notebook ${getDisplayPath(e.uri)}`);
                    if (!newCellExecutionQueue.failed || !newCellExecutionQueue.isEmpty) {
                        await newCellExecutionQueue.cancel(true);
                    }
                }
            },
            this,
            this.disposables
        );
        newCellExecutionQueue.onPreExecute((c) => this._onPreExecute.fire(c), this, this.disposables);
        newCellExecutionQueue.onPostExecute((c) => this._onPostExecute.fire(c), this, this.disposables);
        this.documentExecutions.set(document, newCellExecutionQueue);
        return newCellExecutionQueue;
    }
}
