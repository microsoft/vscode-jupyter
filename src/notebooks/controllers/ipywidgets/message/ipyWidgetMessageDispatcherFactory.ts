// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Event, EventEmitter, NotebookDocument } from 'vscode';
import { IDisposable, IDisposableRegistry } from '../../../../platform/common/types';
import { IPyWidgetMessages } from '../../../../messageTypes';
import { IKernel, IKernelProvider } from '../../../../kernels/types';
import { IPyWidgetMessageDispatcher } from './ipyWidgetMessageDispatcher';
import { IIPyWidgetMessageDispatcher, IPyWidgetMessage } from '../types';

/**
 * This just wraps the iPyWidgetMessageDispatcher class.
 * When raising events for arrived messages, this class will first raise events for
 * all messages that arrived before this class was contructed.
 */
class IPyWidgetMessageDispatcherWithOldMessages implements IIPyWidgetMessageDispatcher {
    public get postMessage(): Event<IPyWidgetMessage> {
        return this._postMessageEmitter.event;
    }
    private _postMessageEmitter = new EventEmitter<IPyWidgetMessage>();
    private readonly disposables: IDisposable[] = [];
    constructor(
        private readonly baseMulticaster: IPyWidgetMessageDispatcher,
        private oldMessages: ReadonlyArray<IPyWidgetMessage>
    ) {
        baseMulticaster.postMessage(this.raisePostMessage, this, this.disposables);
    }

    public dispose() {
        while (this.disposables.length) {
            const disposable = this.disposables.shift();
            disposable?.dispose(); // NOSONAR
        }
    }
    public initialize() {
        return this.baseMulticaster.initialize();
    }

    public receiveMessage(message: IPyWidgetMessage) {
        this.baseMulticaster.receiveMessage(message);
    }
    private raisePostMessage(message: IPyWidgetMessage) {
        // Send all of the old messages the notebook may not have received.
        // Also send them in the same order.
        this.oldMessages.forEach((oldMessage) => {
            this._postMessageEmitter.fire(oldMessage);
        });
        this.oldMessages = [];
        this._postMessageEmitter.fire(message);
    }
}

/**
 * Creates the dispatcher responsible for sending the ipywidget messages to notebooks.
 * The way ipywidgets work are as follows:
 * - IpyWidget framework registers with kernel (registerCommTarget).
 * - IpyWidgets listen to messages from kernel (iopub).
 * - IpyWidgets maintain their own state.
 * - IpyWidgets build their state slowly based on messages arriving/being sent from iopub.
 * - When kernel finally sends a message `display xyz`, ipywidgets looks for data related `xyz` and displays it.
 *   I.e. by now, ipywidgets has all of the data related to `xyz`. `xyz` is merely an id.
 *   I.e. kernel merely sends a message saying `ipywidgets please display the UI related to id xyz`.
 *   The terminology used by ipywidgets for the identifier is the `model id`.
 *
 * Now, if we have another UI opened for the same notebook, e.g. multiple notebooks, we need all of this informtiton.
 * I.e. ipywidgets needs all of the information prior to the `display xyz command` form kernel.
 * For this to happen, ipywidgets needs to be sent all of the messages from the time it registered for a comm target in the original notebook.
 *
 * Solution:
 * - Save all of the messages sent to ipywidgets.
 * - When we open a new notebook, then re-send all of these messages to this new ipywidgets manager in the second notebook.
 * - Now, both ipywidget managers in both notebooks have the same data, hence are able to render the same controls.
 */
@injectable()
export class IPyWidgetMessageDispatcherFactory implements IDisposable {
    private readonly messageDispatchers = new WeakMap<NotebookDocument, IPyWidgetMessageDispatcher>();
    private readonly messagesPerNotebook = new WeakMap<NotebookDocument, IPyWidgetMessage[]>();
    private disposed = false;
    private disposables: IDisposable[] = [];
    constructor(
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider
    ) {
        disposables.push(this);

        kernelProvider.onDidDisposeKernel(this.trackDisposingOfKernels, this, disposables);
    }

    public dispose() {
        this.disposed = true;
        while (this.disposables.length) {
            this.disposables.shift()?.dispose(); // NOSONAR
        }
    }
    public create(document: NotebookDocument): IIPyWidgetMessageDispatcher {
        let baseDispatcher = this.messageDispatchers.get(document);
        if (!baseDispatcher) {
            baseDispatcher = new IPyWidgetMessageDispatcher(this.kernelProvider, document);
            this.messageDispatchers.set(document, baseDispatcher);

            // Capture all messages so we can re-play messages that others missed.
            this.disposables.push(baseDispatcher.postMessage((msg) => this.onMessage(msg, document), this));
        }

        // If we have messages upto this point, then capture those messages,
        // & pass to the dispatcher so it can re-broadcast those old messages.
        // If there are no old messages, even then return a new instance of the class.
        // This way, the reference to that will be controlled by calling code.
        let messages: ReadonlyArray<IPyWidgetMessage> = [];
        if (document && this.messagesPerNotebook.get(document)) {
            messages = this.messagesPerNotebook.get(document) || [];
        }
        const dispatcher = new IPyWidgetMessageDispatcherWithOldMessages(baseDispatcher, messages);
        this.disposables.push(dispatcher);
        return dispatcher;
    }
    private trackDisposingOfKernels(kernel: IKernel) {
        if (this.disposed) {
            return;
        }
        const notebook = kernel.notebook;
        const item = this.messageDispatchers.get(notebook);
        this.messageDispatchers.delete(notebook);
        item?.dispose(); // NOSONAR
    }

    private onMessage(message: IPyWidgetMessage, document?: NotebookDocument) {
        // For now (we only support splitting notebook editors & running the cells again to get widgest in the new editors)
        // This is because if we want all widgets rendererd upto this point to work on the new editors (after splitting),
        // then this has the potential to consume a lot of resources (memory).
        // One solution - store n messages in array, then use file as storage.
        // Next problem, data at rest is not encrypted, now we need to encrypt.
        // Till we decide, lets disable this (& only re-broadcast a smaller subset of messages).
        if (!document) {
            return;
        }
        this.messagesPerNotebook.set(document, this.messagesPerNotebook.get(document) || []);
        if (
            message.message === IPyWidgetMessages.IPyWidgets_kernelOptions ||
            message.message === IPyWidgetMessages.IPyWidgets_registerCommTarget
        ) {
            this.messagesPerNotebook.get(document)!.push(message);
        }
    }
}
