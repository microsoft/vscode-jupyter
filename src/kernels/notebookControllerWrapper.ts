// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    Event,
    EventEmitter,
    NotebookCell,
    NotebookCellExecution,
    NotebookController,
    NotebookControllerAffinity,
    NotebookDocument,
    NotebookEditor,
    NotebookRendererScript,
    Uri
} from 'vscode';
import { disposeAllDisposables } from '../platform/common/helpers';
import { IDisposable } from '../platform/common/types';

/**
 * Returns a class thats identical to NotebookController.
 * Basically similar to a `Proxy` class, but with the ability to determine whether the instance of this class is a proxy or not.
 * & a special method to change the underlying controller.
 *
 * When we create a IKernel when we're about to start a kernel, and this IKernel has a NotebookController & KernelConnectionMetadata associated with it.
 * So, when we start the kernel, the controller in the UI changes from a a remote kernel spec to a live kernel session.
 * What we do here is update the properties (values) of the Notebook controller & the Kernel Connection metadata.
 *
 * Again, all of this could be done by changing the `controller` and `kernelConnectionMetadata` to read-write,
 * however that doesn't work as we pass these object ref values around in a number of places, hence changing the value in IKernel will not help.
 * E.g. in IKernel we pass them to kernel execution, cell execution, cell execution queue, etc,
 * hence if we update a property in IKernel that isn't sufficient, we need to then ensure the same properties in cell execution, cell execution queue, kernel execution etc also have
 * the same rea-write properties. However thats a lot of unnecessary work with the risky introduction of exposing these things as writable properties.
 *
 * These properties can only change when a kernel has started & the controller switches fro Kernel Spec to a live Kernel.
 * & that logic is stored in IKernelProvider, via the call to the `update` method of this class.
 */
export class NotebookControllerWrapper implements NotebookController {
    private readonly controllerEventHandlers: IDisposable[] = [];
    private readonly _onDidChangeSelectedNotebooks = new EventEmitter<{
        readonly notebook: NotebookDocument;
        readonly selected: boolean;
    }>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly _onDidReceiveMessage = new EventEmitter<{ editor: NotebookEditor; message: any }>();
    public get id(): string {
        return this.controller.id;
    }
    public get notebookType(): string {
        return this.controller.notebookType;
    }
    public get supportedLanguages(): string[] | undefined {
        return this.controller.supportedLanguages;
    }
    public set supportedLanguages(value: string[] | undefined) {
        this.controller.supportedLanguages = value;
    }
    public get label(): string {
        return this.controller.label;
    }
    public get description(): string | undefined {
        return this.controller.description;
    }
    public set description(value: string | undefined) {
        this.controller.description = value;
    }
    public get detail(): string | undefined {
        return this.controller.detail;
    }
    public set detail(value: string | undefined) {
        this.controller.detail = value;
    }
    public get supportsExecutionOrder(): boolean | undefined {
        return this.controller.supportsExecutionOrder;
    }
    public set supportsExecutionOrder(value: boolean | undefined) {
        this.controller.supportsExecutionOrder = value;
    }
    public get kind(): string | undefined {
        return this.controller.kind;
    }
    public set kind(value: string | undefined) {
        this.controller.kind = value;
    }
    public get rendererScripts(): NotebookRendererScript[] {
        return this.controller.rendererScripts;
    }
    public get executeHandler(): (
        cells: NotebookCell[],
        notebook: NotebookDocument,
        controller: NotebookController
    ) => void | Thenable<void> {
        return this.controller.executeHandler;
    }
    public set executeHandler(
        handler: (
            cells: NotebookCell[],
            notebook: NotebookDocument,
            controller: NotebookController
        ) => void | Thenable<void>
    ) {
        this.controller.executeHandler = handler;
    }
    public get interruptHandler(): ((notebook: NotebookDocument) => void | Thenable<void>) | undefined {
        return this.controller.interruptHandler;
    }
    public set interruptHandler(handler: ((notebook: NotebookDocument) => void | Thenable<void>) | undefined) {
        this.controller.interruptHandler = handler;
    }
    public get onDidChangeSelectedNotebooks(): Event<{
        readonly notebook: NotebookDocument;
        readonly selected: boolean;
    }> {
        return this._onDidChangeSelectedNotebooks.event;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public get onDidReceiveMessage(): Event<{ editor: NotebookEditor; message: any }> {
        return this._onDidReceiveMessage.event;
    }

    private constructor(private controller: NotebookController) {}
    public static wrap(controller: NotebookController): NotebookControllerWrapper {
        if (controller instanceof NotebookControllerWrapper) {
            return controller;
        }
        return new NotebookControllerWrapper(controller);
    }
    public static isWrapped(controller: NotebookController): controller is NotebookControllerWrapper {
        return controller instanceof NotebookControllerWrapper;
    }
    createNotebookCellExecution(cell: NotebookCell): NotebookCellExecution {
        return this.controller.createNotebookCellExecution(cell);
    }
    updateNotebookAffinity(notebook: NotebookDocument, affinity: NotebookControllerAffinity): void {
        this.controller.updateNotebookAffinity(notebook, affinity);
    }
    dispose(): void {
        disposeAllDisposables(this.controllerEventHandlers);
        this._onDidChangeSelectedNotebooks.dispose();
        this._onDidReceiveMessage.dispose();
        this.controller.dispose();
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    postMessage(message: any, editor?: NotebookEditor | undefined): Thenable<boolean> {
        return this.controller.postMessage(message, editor);
    }
    asWebviewUri(localResource: Uri): Uri {
        return this.controller.asWebviewUri(localResource);
    }
    public update(controller: NotebookController) {
        disposeAllDisposables(this.controllerEventHandlers);
        this.controller = controller;
        this.addControllerEvents();
    }
    private addControllerEvents() {
        this.controller.onDidChangeSelectedNotebooks(
            (e) => this._onDidChangeSelectedNotebooks.fire(e),
            this,
            this.controllerEventHandlers
        );
        this.controller.onDidReceiveMessage(
            (e) => this._onDidReceiveMessage.fire(e),
            this,
            this.controllerEventHandlers
        );
    }
}
