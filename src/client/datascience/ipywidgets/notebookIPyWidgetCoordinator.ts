// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { inject, injectable } from 'inversify';
import { Disposable } from 'vscode';
import { NotebookCommunication, NotebookDocument, NotebookKernel } from '../../../../types/vscode-proposed';
import { IExtensionSingleActivationService } from '../../activation/types';
import { IVSCodeNotebook } from '../../common/application/types';
import { IServiceContainer } from '../../ioc/types';
import { InteractiveWindowMessages } from '../interactive-common/interactiveWindowTypes';
import { INotebookKernelProvider } from '../notebook/types';
import { CommonMessageCoordinator } from './commonMessageCoordinator';

/**
 * This class wires up VSC notebooks to ipywidget communications.
 */
@injectable()
export class NotebookIPyWidgetCoordinator implements IExtensionSingleActivationService {
    private messageCoordinators = new Map<string, Promise<CommonMessageCoordinator>>();
    private attachedWebViews = new Map<string, { webviews: Set<string>; disposables: Disposable[] }>();
    private disposables: Disposable[] = [];
    constructor(
        @inject(INotebookKernelProvider) notebookKernelProvider: INotebookKernelProvider,
        @inject(IServiceContainer) private readonly serviceContainer: IServiceContainer,
        @inject(IVSCodeNotebook) private readonly notebookProvider: IVSCodeNotebook
    ) {
        notebookKernelProvider.onResolvedKernel(this.onResolvedKernel.bind(this));
        if (notebookKernelProvider.onDidChangeKernels) {
            notebookKernelProvider.onDidChangeKernels(this.onDidChangeKernels.bind(this));
        }
        notebookProvider.onDidCloseNotebookDocument(this.onDidCloseNotebook.bind(this));
    }
    public async activate(): Promise<void> {
        // We don't need to do anything here. We'll signup on resolve kernel events
    }
    public dispose(): void | undefined {
        this.messageCoordinators.forEach((v) => v.then((c) => c.dispose()));
        this.messageCoordinators.clear();
    }
    private onResolvedKernel(arg: {
        kernel: NotebookKernel;
        document: NotebookDocument;
        webview: NotebookCommunication;
    }) {
        // Create a handler for this notebook if we don't already have one. Since there's one of the notebookMessageCoordinator's for the
        // entire VS code session, we have a map of notebook document to message coordinator
        let promise = this.messageCoordinators.get(arg.document.uri.toString());
        if (!promise) {
            promise = CommonMessageCoordinator.create(arg.document.uri, this.serviceContainer);
            this.messageCoordinators.set(arg.document.uri.toString(), promise);
        }
        promise.then(this.attachCoordinator.bind(this, arg.document, arg.webview)).ignoreErrors();
    }

    private onDidCloseNotebook(e: NotebookDocument) {
        // See if this is the last copy of this document
        if (!this.notebookProvider.notebookDocuments.find((d) => d.uri !== e.uri)) {
            const coordinator = this.messageCoordinators.get(e.uri.toString());
            coordinator?.then((c) => c.dispose());
            this.messageCoordinators.delete(e.uri.toString());
            const attachment = this.attachedWebViews.get(e.uri.toString());
            attachment?.disposables?.forEach((d) => d.dispose());
        }
    }

    private attachCoordinator(document: NotebookDocument, webview: NotebookCommunication, c: CommonMessageCoordinator) {
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
            this.disposables.push(
                webview.onDidReceiveMessage((m) => {
                    c.onMessage(m.type, m.payload);
                })
            );
        }
    }
    private onDidChangeKernels(_document: NotebookDocument | undefined) {
        // Might have to destroy the coordinator? It needs to resign up for kernel events
    }
}
