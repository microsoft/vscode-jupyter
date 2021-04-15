// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { inject, injectable } from 'inversify';
import { NotebookCommunication, NotebookDocument, CancellationToken } from 'vscode';
import { IVSCodeNotebook } from '../../common/application/types';
import { Cancellation } from '../../common/cancellation';
import { disposeAllDisposables } from '../../common/helpers';
import { IDisposable } from '../../common/types';
import { createDeferred } from '../../common/utils/async';
import { IServiceContainer } from '../../ioc/types';
import { InteractiveWindowMessages, IPyWidgetMessages } from '../interactive-common/interactiveWindowTypes';
import { INotebookKernelResolver } from '../notebook/types';
import { CommonMessageCoordinator } from './commonMessageCoordinator';

/**
 * This class wires up VSC notebooks to ipywidget communications.
 */
@injectable()
export class NotebookIPyWidgetCoordinator implements INotebookKernelResolver {
    private messageCoordinators = new Map<
        NotebookDocument,
        { webview: NotebookCommunication; promise: Promise<CommonMessageCoordinator> }[]
    >();
    private attachedWebViews = new Map<
        NotebookDocument,
        { webview: NotebookCommunication; disposables: IDisposable[] }[]
    >();
    constructor(
        @inject(IServiceContainer) private readonly serviceContainer: IServiceContainer,
        @inject(IVSCodeNotebook) private readonly notebookProvider: IVSCodeNotebook
    ) {
        notebookProvider.onDidCloseNotebookDocument(this.onDidCloseNotebook.bind(this));
    }
    public dispose(): void | undefined {
        this.messageCoordinators.forEach((v) => v.forEach((item) => item.promise.then((c) => c.dispose())));
        this.messageCoordinators.clear();
    }
    public resolveKernel(
        document: NotebookDocument,
        webview: NotebookCommunication,
        token: CancellationToken
    ): Promise<void> {
        const promise = CommonMessageCoordinator.create(document.uri, this.serviceContainer, undefined, webview);
        this.messageCoordinators.set(document, this.messageCoordinators.get(document) || []);
        this.messageCoordinators.get(document)!.push({ webview, promise });
        return Cancellation.race(() => promise!.then(this.attachCoordinator.bind(this, document, webview)), token);
    }

    private onDidCloseNotebook(e: NotebookDocument) {
        // See if this is the last copy of this document
        if (!this.notebookProvider.notebookDocuments.find((d) => d.uri === e.uri)) {
            const coordinators = this.messageCoordinators.get(e);
            coordinators?.forEach((item) => item.promise.then((c) => c.dispose()));
            this.messageCoordinators.delete(e);
            const attachments = this.attachedWebViews.get(e);
            attachments?.forEach((item) => disposeAllDisposables(item.disposables));
        }
    }

    private attachCoordinator(
        document: NotebookDocument,
        webview: NotebookCommunication,
        c: CommonMessageCoordinator
    ): Promise<void> {
        const promise = createDeferred<void>();
        this.attachedWebViews.set(document, this.attachedWebViews.get(document) || []);
        const attachments = this.attachedWebViews.get(document)!;
        const disposables: IDisposable[] = [];
        attachments.push({ webview, disposables });

        // Attach message requests to this webview (should dupe to all of them)
        disposables.push(
            c.postMessage((e) => {
                // Special case for webview URI translation
                if (e.message === InteractiveWindowMessages.ConvertUriForUseInWebViewRequest) {
                    c.onMessage(InteractiveWindowMessages.ConvertUriForUseInWebViewResponse, {
                        request: e.payload,
                        response: webview.asWebviewUri(e.payload)
                    });
                } else {
                    void webview.postMessage({ type: e.message, payload: e.payload });
                }
            })
        );
        disposables.push(
            webview.onDidReceiveMessage((m) => {
                c.onMessage(m.type, m.payload);

                // Special case the WidgetManager loaded message. It means we're ready
                // to use a kernel. (IPyWidget Dispatcher uses this too)
                if (m.type === IPyWidgetMessages.IPyWidgets_Ready) {
                    promise.resolve();
                }
            })
        );

        return promise.promise;
    }
}
