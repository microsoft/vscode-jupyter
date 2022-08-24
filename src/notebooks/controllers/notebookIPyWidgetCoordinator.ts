// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import {
    NotebookDocument,
    CancellationToken,
    Disposable,
    NotebookEditor,
    Uri,
    EventEmitter,
    CancellationTokenSource
} from 'vscode';
import { IVSCodeNotebook } from '../../platform/common/application/types';
import { Cancellation } from '../../platform/common/cancellation';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { traceVerbose } from '../../platform/logging';
import { getDisplayPath } from '../../platform/common/platform/fs-paths';
import { IDisposableRegistry, IDisposable } from '../../platform/common/types';
import { noop } from '../../platform/common/utils/misc';
import { IServiceContainer } from '../../platform/ioc/types';
import { IControllerSelection, IVSCodeNotebookController } from '../../notebooks/controllers/types';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IWebviewCommunication } from '../../platform/webviews/types';
import { IKernelProvider } from '../../kernels/types';
import { CommonMessageCoordinator } from './ipywidgets/message/commonMessageCoordinator';

/**
 * Posts/Receives messages from the renderer in order to have kernel messages available in the webview
 */
class NotebookCommunication implements IWebviewCommunication, IDisposable {
    private eventHandlerListening?: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private pendingMessages: any[] = [];
    private readonly disposables: IDisposable[] = [];
    private controllerMessageHandler?: IDisposable;
    private _controller?: IVSCodeNotebookController;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly _onDidReceiveMessage = new EventEmitter<any>();
    public get controller() {
        return this._controller!.controller!;
    }
    constructor(
        public readonly editor: NotebookEditor,
        private readonly controllerSelection: IControllerSelection,
        private readonly kernelProvider: IKernelProvider
    ) {
        this.changeController(controllerSelection.getSelected(editor.notebook)!);
    }
    public get isReady() {
        const kernel = this.kernelProvider.get(this.editor.notebook.uri);
        if (!kernel) {
            return false;
        }
        switch (kernel.kernelConnectionMetadata.kind) {
            case 'startUsingRemoteKernelSpec':
                // If user is initially connected to a kernel spec, then when they start the kernel,
                // we create a live kernel and change the controller to point to that.
                // However the kernel here is still pointing to the kernel spec, hence
                // we need to wait for the kernel connection to change & point to the live kernel.
                // The reason we need to wait is, when the controller changes, the webview gets re-loaded,
                // hence the webview isn't ready, until its reloaded in this case (i.e. controller changes from kernelspec to live kernel).
                return false;
            case 'connectToLiveRemoteKernel':
                const currentController = this.controllerSelection.getSelected(this.editor.notebook);
                if (currentController?.connection.id !== kernel.kernelConnectionMetadata.id) {
                    // Possible we've created the controller, however it hasn't been selected just yet.
                    // In such a case we need to wait for out code to detect the change from kernel spec controller to live kernel controller.
                    return false;
                }
                if (currentController.id !== this.controller.id) {
                    // Wait till this class also detects the change to the controller (i.e. change from kernelspec to live kernel)
                    return false;
                }
                return true;
            default:
                return true;
        }
    }
    public changeController(controller: IVSCodeNotebookController) {
        if (this._controller?.id === controller.id) {
            return;
        }
        this.controllerMessageHandler?.dispose();
        this._controller = controller;
        this.controllerMessageHandler = controller.onDidReceiveMessage(
            (e) => {
                // Handle messages from this only if its still the active controller.
                if (e.editor === this.editor && this._controller?.id === controller.id) {
                    // If the listeners haven't been hooked up, then dont fire the event (nothing listening).
                    // Instead buffer the messages and fire the events later.
                    if (this.eventHandlerListening) {
                        this.sendPendingMessages();
                        this._onDidReceiveMessage.fire(e.message);
                    } else {
                        this.pendingMessages.push(e.message);
                    }
                }
            },
            this,
            this.disposables
        );
    }
    public dispose() {
        disposeAllDisposables(this.disposables);
    }
    public get onDidReceiveMessage() {
        this.eventHandlerListening = true;
        // Immediately after the event handler is added, send the pending messages.
        setTimeout(() => this.sendPendingMessages(), 0);
        return this._onDidReceiveMessage.event;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public postMessage(message: any): Thenable<boolean> {
        return this.controller!.postMessage(message, this.editor);
    }
    public asWebviewUri(localResource: Uri): Uri {
        return this.controller!.asWebviewUri(localResource);
    }
    private sendPendingMessages() {
        if (this.pendingMessages.length) {
            let message = this.pendingMessages.shift();
            while (message) {
                this._onDidReceiveMessage.fire(message);
                message = this.pendingMessages.shift();
            }
        }
    }
}

/**
 * This class wires up VSC notebooks to ipywidget communications.
 */
@injectable()
export class NotebookIPyWidgetCoordinator implements IExtensionSyncActivationService {
    private readonly messageCoordinators = new WeakMap<NotebookDocument, Promise<CommonMessageCoordinator>>();
    private readonly notebookDisposables = new WeakMap<NotebookDocument, Disposable[]>();
    private readonly notebookCommunications = new WeakMap<NotebookEditor, NotebookCommunication>();
    private controllerManager: IControllerSelection;
    constructor(
        @inject(IServiceContainer) private readonly serviceContainer: IServiceContainer,
        @inject(IDisposableRegistry) private readonly disposableRegistry: IDisposableRegistry,
        @inject(IVSCodeNotebook) private readonly notebook: IVSCodeNotebook
    ) {}
    public activate(): void {
        this.controllerManager = this.serviceContainer.get<IControllerSelection>(IControllerSelection);
        this.notebook.onDidChangeVisibleNotebookEditors(
            this.onDidChangeVisibleNotebookEditors,
            this,
            this.disposableRegistry
        );
        this.notebook.onDidCloseNotebookDocument(this.onDidCloseNotebookDocument, this, this.disposableRegistry);
        this.controllerManager.onControllerSelected(this.onDidSelectController, this, this.disposableRegistry);
    }
    public onDidSelectController(e: { notebook: NotebookDocument; controller: IVSCodeNotebookController }) {
        // Dispose previous message coordinators.
        const previousCoordinators = this.messageCoordinators.get(e.notebook);
        if (previousCoordinators) {
            this.messageCoordinators.delete(e.notebook);
            this.notebook.notebookEditors
                .filter((editor) => editor.notebook === e.notebook)
                .forEach((editor) => {
                    const comms = this.notebookCommunications.get(editor);
                    if (comms && comms.controller !== e.controller.controller) {
                        this.notebookCommunications.delete(editor);
                        if (comms) {
                            comms.dispose();
                        }
                    }
                });
            previousCoordinators.then((item) => item.dispose()).catch(noop);
        }
        // Possible user has split the notebook editor, if that's the case we need to hookup comms with this new editor as well.
        this.notebook.notebookEditors.forEach((editor) => this.initializeNotebookCommunication(editor, e.controller));
    }
    private initializeNotebookCommunication(editor: NotebookEditor, controller: IVSCodeNotebookController | undefined) {
        const notebook = editor.notebook;
        if (!controller) {
            traceVerbose(
                `No controller, hence notebook communications cannot be initialized for editor ${getDisplayPath(
                    editor.notebook.uri
                )}`
            );
            return;
        }
        if (this.notebookCommunications.has(editor)) {
            traceVerbose(
                `notebook communications already initialized for editor ${getDisplayPath(editor.notebook.uri)}`
            );
            return;
        }
        traceVerbose(`Initialize notebook communications for editor ${getDisplayPath(editor.notebook.uri)}`);
        const kernelProvider = this.serviceContainer.get<IKernelProvider>(IKernelProvider);
        const comms = new NotebookCommunication(editor, this.controllerManager, kernelProvider);
        this.addNotebookDisposables(notebook, [comms]);
        this.notebookCommunications.set(editor, comms);
        const { token } = new CancellationTokenSource();
        this.resolveKernel(notebook, comms, token).catch(noop);
    }
    private resolveKernel(
        document: NotebookDocument,
        webview: IWebviewCommunication,
        token: CancellationToken
    ): Promise<void> {
        // Create a handler for this notebook if we don't already have one. Since there's one of the notebookMessageCoordinator's for the
        // entire VS code session, we have a map of notebook document to message coordinator
        traceVerbose(`Resolving notebook UI Comms (resolve) for ${getDisplayPath(document.uri)}`);
        let promise = this.messageCoordinators.get(document);
        if (promise === undefined) {
            const coordinator = new CommonMessageCoordinator(document, this.serviceContainer);
            promise = coordinator.attach(webview).then(() => coordinator);
            this.messageCoordinators.set(document, promise);
        }
        return Cancellation.race(async () => {
            await promise;
        }, token);
    }
    private addNotebookDisposables(notebook: NotebookDocument, disposables: IDisposable[]) {
        const currentDisposables: IDisposable[] = this.notebookDisposables.get(notebook) || [];
        currentDisposables.push(...disposables);
        this.notebookDisposables.set(notebook, currentDisposables);
    }
    private async onDidChangeVisibleNotebookEditors(e: readonly NotebookEditor[]) {
        // Find any new editors that may be associated with the current notebook.
        // This can happen when users split editors.
        e.forEach((editor) => {
            const controller = this.controllerManager.getSelected(editor.notebook);
            this.initializeNotebookCommunication(editor, controller);
        });
    }
    private onDidCloseNotebookDocument(notebook: NotebookDocument) {
        const coordinator = this.messageCoordinators.get(notebook);
        coordinator?.then((c) => c.dispose()).catch(noop);
        this.messageCoordinators.delete(notebook);
    }
}
