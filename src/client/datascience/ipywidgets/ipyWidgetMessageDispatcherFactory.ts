// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { Event, EventEmitter, Uri } from 'vscode';
import { IDisposable, IDisposableRegistry } from '../../common/types';
import { IPyWidgetMessages } from '../interactive-common/interactiveWindowTypes';
import { INotebook, INotebookProvider } from '../types';
import { IPyWidgetMessageDispatcher } from './ipyWidgetMessageDispatcher';
import { IIPyWidgetMessageDispatcher, IPyWidgetMessage } from './types';

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
    public async initialize() {
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
 * Now, if we have another UI opened for the same notebook, e.g. multiple notebooks, we need all of this information.
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
    private readonly messageDispatchers = new Map<string, IPyWidgetMessageDispatcher>();
    private readonly messagesByUri = new Map<string, IPyWidgetMessage[]>();
    private disposed = false;
    private disposables: IDisposable[] = [];
    constructor(
        @inject(INotebookProvider) private notebookProvider: INotebookProvider,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry
    ) {
        disposables.push(this);
        notebookProvider.onNotebookCreated((e) => this.trackDisposingOfNotebook(e.notebook), this, this.disposables);

        notebookProvider.activeNotebooks.forEach((nbPromise) =>
            nbPromise.then((notebook) => this.trackDisposingOfNotebook(notebook)).ignoreErrors()
        );
    }

    public dispose() {
        this.disposed = true;
        while (this.disposables.length) {
            this.disposables.shift()?.dispose(); // NOSONAR
        }
    }
    public create(identity: Uri): IIPyWidgetMessageDispatcher {
        let baseDispatcher = this.messageDispatchers.get(identity.fsPath);
        if (!baseDispatcher) {
            baseDispatcher = new IPyWidgetMessageDispatcher(this.notebookProvider, identity);
            this.messageDispatchers.set(identity.fsPath, baseDispatcher);

            // Capture all messages so we can re-play messages that others missed.
            this.disposables.push(baseDispatcher.postMessage((e) => this.onMessage(identity.toString(), e), this));
        }

        // If we have messages upto this point, then capture those messages,
        // & pass to the dispatcher so it can re-broadcast those old messages.
        // If there are no old messages, even then return a new instance of the class.
        // This way, the reference to that will be controlled by calling code.
        const dispatcher = new IPyWidgetMessageDispatcherWithOldMessages(
            baseDispatcher,
            (this.messagesByUri.get(identity.toString()) || []) as ReadonlyArray<IPyWidgetMessage>
        );
        this.disposables.push(dispatcher);
        return dispatcher;
    }
    private trackDisposingOfNotebook(notebook: INotebook) {
        if (this.disposed) {
            return;
        }
        notebook.onDisposed(
            () => {
                const item = this.messageDispatchers.get(notebook.identity.fsPath);
                this.messageDispatchers.delete(notebook.identity.fsPath);
                item?.dispose(); // NOSONAR
            },
            this,
            this.disposables
        );
    }

    private onMessage(uri: string, message: IPyWidgetMessage) {
        // Disabled for now, as this has the potential to consume a lot of resources (memory).
        // One solution - store n messages in array, then use file as storage.
        // Next problem, data at rest is not encrypted, now we need to encrypt.
        // Till we decide, lets disable this.
        if (!this.messagesByUri.has(uri)) {
            this.messagesByUri.set(uri, []);
        }
        if (
            message.message === IPyWidgetMessages.IPyWidgets_kernelOptions ||
            message.message === IPyWidgetMessages.IPyWidgets_registerCommTarget
        ) {
            this.messagesByUri.get(uri)!.push(message);
        }
        if (message.message === IPyWidgetMessages.IPyWidgets_mirror_execute) {
            return;
        }
        // if (
        //     message.message === IPyWidgetMessages.IPyWidgets_msg &&
        //     'data' in message.payload &&
        //     typeof message.payload.data === 'string' &&
        //     (message.payload.data.includes('comm_open') || message.payload.data.includes('comm_msg'))
        // ) {
        //     const msg = JSON.parse(message.payload.data) as KernelMessage.IMessage;
        //     if (msg.header.msg_type === 'comm_open' || msg.header.msg_type === 'comm_msg') {
        //         this.messagesByUri.get(uri)!.push(message);
        //     }
        // }
        // if (message.message === IPyWidgetMessages.IPyWidgets_msg) {
        //     const msg = JSON.parse(message.payload.data) as KernelMessage.IMessage;
        //     if (
        //         msg.header.msg_type === 'clear_output' ||
        //         msg.header.msg_type === 'stream' ||
        //         msg.header.msg_type === 'execute_input' ||
        //         msg.header.msg_type === 'error' ||
        //         msg.header.msg_type === 'debug_event' ||
        //         msg.header.msg_type === 'complete_reply' ||
        //         msg.header.msg_type === 'complete_request' ||
        //         msg.header.msg_type === 'debug_reply' ||
        //         msg.header.msg_type === 'debug_request' ||
        //         msg.header.msg_type === 'comm_close' ||
        //         msg.header.msg_type === 'comm_info_reply' ||
        //         msg.header.msg_type === 'comm_info_request' ||
        //         msg.header.msg_type === 'execute_reply' ||
        //         msg.header.msg_type === 'execute_request' ||
        //         msg.header.msg_type === 'execute_result' ||
        //         msg.header.msg_type === 'history_reply' ||
        //         msg.header.msg_type === 'history_request' ||
        //         msg.header.msg_type === 'input_reply' ||
        //         msg.header.msg_type === 'input_request' ||
        //         msg.header.msg_type === 'inspect_reply' ||
        //         msg.header.msg_type === 'inspect_request' ||
        //         msg.header.msg_type === 'interrupt_reply' ||
        //         msg.header.msg_type === 'interrupt_request' ||
        //         msg.header.msg_type === 'is_complete_reply' ||
        //         msg.header.msg_type === 'is_complete_request' ||
        //         msg.header.msg_type === 'kernel_info_reply' ||
        //         msg.header.msg_type === 'kernel_info_request' ||
        //         msg.header.msg_type === 'shutdown_reply' ||
        //         msg.header.msg_type === 'shutdown_request' ||
        //         msg.header.msg_type === 'status'
        //     ) {
        //         return;
        //     }
        // }
        this.messagesByUri.get(uri)!.push(message);
    }
}
