// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
    Disposable,
    extensions,
    l10n,
    NotebookController,
    NotebookDocument,
    NotebookExecution,
    ProgressLocation,
    window,
    workspace
} from 'vscode';
import { createDeferred, Deferred, sleep } from '../../../platform/common/utils/async';
import { IDisposable } from '../../../platform/common/types';
import { IKernel } from '../../../kernels/types';
import { getDisplayNameOrNameOfKernelConnection } from '../../../kernels/helpers';
import { IReference, ReferenceCollection } from '../../../platform/common/utils/lifecycle';
import { noop } from '../../../platform/common/utils/misc';

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

export class KernelExecutionProgressIndicator {
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
        let execution: IReference<NotebookExecution> | undefined;
        try {
            execution = this.executionRefCountedDisposableFactory?.acquire('');
        } catch {
            // It's okay to not acquire an execution ref here as there may already be one.
            // E.g. when user is executing a cell, then an execution is already in progress & a progress will be displayed.
            // Hence no need to acquire another execution ref.
        }

        if (this.deferred && !this.deferred.completed) {
            const oldDeferred = this.deferred;
            this.deferred = createDeferred<void>();
            oldDeferred.resolve();
        } else {
            this.deferred = createDeferred<void>();
            void this.showProgress().catch(noop);
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
