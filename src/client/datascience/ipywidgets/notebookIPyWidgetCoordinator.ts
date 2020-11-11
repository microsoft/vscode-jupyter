// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { inject, injectable } from 'inversify';
import { Disposable } from 'vscode';
import { NotebookCommunication, NotebookDocument, NotebookKernel } from '../../../../types/vscode-proposed';
import { IExtensionSingleActivationService } from '../../activation/types';
import { IServiceContainer } from '../../ioc/types';
import { InteractiveWindowMessages } from '../interactive-common/interactiveWindowTypes';
import { INotebookKernelProvider } from '../notebook/types';
import { CommonMessageCoordinator } from './commonMessageCoordinator';

@injectable()
export class NotebookIPyWidgetCoordinator implements IExtensionSingleActivationService {
    private messageCoordinators = new Map<string, Promise<CommonMessageCoordinator>>();
    private attachedWebViews = new Set<string>();
    private disposables: Disposable[] = [];
    constructor(
        @inject(INotebookKernelProvider) notebookKernelProvider: INotebookKernelProvider,
        @inject(IServiceContainer) private readonly serviceContainer: IServiceContainer
    ) {
        notebookKernelProvider.onResolvedKernel(this.onResolvedKernel.bind(this));
        if (notebookKernelProvider.onDidChangeKernels) {
            notebookKernelProvider.onDidChangeKernels(this.onDidChangeKernels.bind(this));
        }
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
        promise.then(this.attachCoordinator.bind(this, arg.webview)).ignoreErrors();
    }

    private attachCoordinator(webview: NotebookCommunication, c: CommonMessageCoordinator) {
        if (!this.attachedWebViews.has(webview.editorId)) {
            this.attachedWebViews.add(webview.editorId);
            this.disposables.push(
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

            // Might have to dispose on shutdown of the webview?
        }
    }
    private onDidChangeKernels(_document: NotebookDocument | undefined) {
        // Might have to destroy the coordinator? It needs to resign up for kernel events
    }
}
