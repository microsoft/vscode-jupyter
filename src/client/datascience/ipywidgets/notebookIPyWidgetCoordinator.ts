// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { inject, injectable } from 'inversify';
import { CancellationToken, Disposable } from 'vscode';
import { NotebookCommunication, NotebookDocument, NotebookKernel } from '../../../../types/vscode-proposed';
import { IVSCodeNotebook } from '../../common/application/types';
import { Cancellation } from '../../common/cancellation';
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
    private messageCoordinators = new Map<string, Promise<CommonMessageCoordinator>>();
    private attachedWebViews = new Map<string, { webviews: Set<string>; disposables: Disposable[] }>();
    private disposables: Disposable[] = [];
    constructor(
        @inject(IServiceContainer) private readonly serviceContainer: IServiceContainer,
        @inject(IVSCodeNotebook) private readonly notebookProvider: IVSCodeNotebook
    ) {
        notebookProvider.onDidCloseNotebookDocument(this.onDidCloseNotebook.bind(this));
    }
    public dispose(): void | undefined {
        this.messageCoordinators.forEach((v) => v.then((c) => c.dispose()));
        this.messageCoordinators.clear();
    }
    public resolveKernel(
        _kernel: NotebookKernel,
        document: NotebookDocument,
        webview: NotebookCommunication,
        token: CancellationToken
    ): Promise<void> {
        // Create a handler for this notebook if we don't already have one. Since there's one of the notebookMessageCoordinator's for the
        // entire VS code session, we have a map of notebook document to message coordinator
        let promise = this.messageCoordinators.get(document.uri.toString());
        if (!promise) {
            promise = CommonMessageCoordinator.create(document.uri, this.serviceContainer);
            this.messageCoordinators.set(document.uri.toString(), promise);
        }
        return Cancellation.race(() => promise!.then(this.attachCoordinator.bind(this, document, webview)), token);
    }

    private onDidCloseNotebook(e: NotebookDocument) {
        // See if this is the last copy of this document
        if (!this.notebookProvider.notebookDocuments.find((d) => d.uri === e.uri)) {
            const coordinator = this.messageCoordinators.get(e.uri.toString());
            coordinator?.then((c) => c.dispose());
            this.messageCoordinators.delete(e.uri.toString());
            const attachment = this.attachedWebViews.get(e.uri.toString());
            attachment?.disposables?.forEach((d) => d.dispose());
        }
    }

    private attachCoordinator(
        document: NotebookDocument,
        webview: NotebookCommunication,
        c: CommonMessageCoordinator
    ): Promise<void> {
        const promise = createDeferred<void>();
        let attachment = this.attachedWebViews.get(document.uri.toString());
        if (!attachment) {
            attachment = { webviews: new Set<string>(), disposables: [] };
            this.attachedWebViews.set(document.uri.toString(), attachment);
        }
        if (!attachment.webviews.has(webview.editorId)) {
            attachment.webviews.add(webview.editorId);

            // Attach message requests to this webview (should dupe to all of them)
            attachment.disposables.push(
                c.postMessage((e) => {
                    // Special case for webview URI translation
                    if (e.message === InteractiveWindowMessages.ConvertUriForUseInWebViewRequest) {
                        c.onMessage(InteractiveWindowMessages.ConvertUriForUseInWebViewResponse, {
                            request: e.payload,
                            response: webview.asWebviewUri(e.payload)
                        });
                    } else {
                        webview.postMessage({ type: e.message, payload: e.payload });
                    }
                })
            );
            attachment.disposables.push(
                webview.onDidReceiveMessage((m) => {
                    c.onMessage(m.type, m.payload);

                    // Special case the WidgetManager loaded message. It means we're ready
                    // to use a kernel. (IPyWidget Dispatcher uses this too)
                    if (m.type === IPyWidgetMessages.IPyWidgets_Ready) {
                        promise.resolve();
                    }
                })
            );
        }

        return promise.promise;
    }
}
