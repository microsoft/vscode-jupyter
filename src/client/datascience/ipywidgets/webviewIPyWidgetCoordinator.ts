// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { Disposable, Event, EventEmitter, Uri } from 'vscode';
import { traceError } from '../../common/logger';
import { IServiceContainer } from '../../ioc/types';
import { INotebookIdentity, InteractiveWindowMessages } from '../interactive-common/interactiveWindowTypes';
import { IInteractiveWindowListener } from '../types';
import { CommonMessageCoordinator } from './commonMessageCoordinator';

/**
 * This class sets up ipywidget communication with a webview
 */
@injectable()
export class WebviewIPyWidgetCoordinator implements IInteractiveWindowListener {
    // tslint:disable-next-line: no-any
    public get postMessage(): Event<{ message: string; payload: any }> {
        return this.postEmitter.event;
    }
    // tslint:disable-next-line: no-any
    public get postInternalMessage(): Event<{ message: string; payload: any }> {
        return this.postInternalMessageEmitter.event;
    }
    private notebookIdentity: Uri | undefined;
    // tslint:disable-next-line: no-any
    private postEmitter: EventEmitter<{ message: string; payload: any }> = new EventEmitter<{
        message: string;
        // tslint:disable-next-line: no-any
        payload: any;
    }>();
    // tslint:disable-next-line: no-any
    private postInternalMessageEmitter: EventEmitter<{ message: string; payload: any }> = new EventEmitter<{
        message: string;
        // tslint:disable-next-line: no-any
        payload: any;
    }>();
    private messageCoordinator: CommonMessageCoordinator | undefined;
    private messageCoordinatorEvent: Disposable | undefined;

    constructor(@inject(IServiceContainer) private readonly serviceContainer: IServiceContainer) {}

    public dispose() {
        this.messageCoordinatorEvent?.dispose(); // NOSONAR
        this.messageCoordinator?.dispose(); // NOSONAR
    }

    // tslint:disable-next-line: no-any
    public onMessage(message: string, payload?: any): void {
        if (message === InteractiveWindowMessages.NotebookIdentity) {
            this.saveIdentity(payload).catch((ex) => traceError('Failed to initialize ipywidgetHandler', ex));
        } else if (message === InteractiveWindowMessages.NotebookClose) {
            this.dispose();
        } else {
            this.messageCoordinator?.onMessage(message, payload);
        }
    }

    private async saveIdentity(args: INotebookIdentity) {
        // There should be an instance of the WebviewMessageCoordinator per notebook webview or interactive window. Create
        // the message coordinator as soon as we're sure what notebook we're in.
        this.notebookIdentity = args.resource;
        this.messageCoordinator = CommonMessageCoordinator.create(this.notebookIdentity, this.serviceContainer);
        this.messageCoordinatorEvent = this.messageCoordinator.postMessage((e) => {
            // Special case a specific message. It must be posted to the internal class, not the webview
            if (e.message === InteractiveWindowMessages.ConvertUriForUseInWebViewRequest) {
                this.postInternalMessageEmitter.fire(e);
            } else {
                this.postEmitter.fire(e);
            }
        });
        this.messageCoordinator.initialize();
    }
}
