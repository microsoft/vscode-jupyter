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
    private controller?: IVSCodeNotebookController;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly _onDidReceiveMessage = new EventEmitter<any>();
    constructor(public readonly editor: NotebookEditor, controller: IVSCodeNotebookController) {
        this.changeController(controller);
    }
    public changeController(controller: IVSCodeNotebookController) {
        if (this.controller?.id === controller.id) {
            return;
        }
        this.controllerMessageHandler?.dispose();
        this.controller = controller;
        this.controllerMessageHandler = controller.onDidReceiveMessage(
            (e) => {
                // Handle messages from this only if its still the active controller.
                if (e.editor === this.editor && this.controller?.id === controller.id) {
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
    /**
     * Public for testing purposes
     */
    public readonly notebookCommunications = new WeakMap<NotebookEditor, NotebookCommunication>();
    private readonly notebookEditors = new WeakMap<NotebookDocument, NotebookEditor[]>();
    constructor(
        @inject(IServiceContainer) private readonly serviceContainer: IServiceContainer,
        @inject(IDisposableRegistry) private readonly disposableRegistry: IDisposableRegistry,
        @inject(IVSCodeNotebook) private readonly notebook: IVSCodeNotebook,
        @inject(IControllerSelection) private readonly controllerManager: IControllerSelection
    ) {}
    public activate(): void {
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
                    this.notebookCommunications.delete(editor);
                    if (comms) {
                        comms.dispose();
                    }
                });
            previousCoordinators.then((item) => item.dispose()).catch(noop);
        }
        // Swap the controller in the communication objects (if we have any).
        const editors = this.notebookEditors.get(e.notebook) || [];
        const notebookComms = editors
            .filter((editor) => this.notebookCommunications.has(editor))
            .map((editor) => this.notebookCommunications.get(editor)!);
        notebookComms.forEach((comm) => comm.changeController(e.controller));

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
        traceVerbose(`Intiailize notebook communications for editor ${getDisplayPath(editor.notebook.uri)}`);
        const comms = new NotebookCommunication(editor, controller);
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
        const editors = this.notebookEditors.get(notebook) || [];
        disposeAllDisposables(this.notebookDisposables.get(notebook) || []);
        editors.forEach((editor) => this.notebookCommunications.get(editor)?.dispose());

        const coordinator = this.messageCoordinators.get(notebook);
        coordinator?.then((c) => c.dispose()).catch(noop);
        this.messageCoordinators.delete(notebook);
    }
}
