// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type * as nbformat from '@jupyterlab/nbformat';
import type { IKernelConnection } from '@jupyterlab/services/lib/kernel/kernel';
import { IIOPubMessage, IOPubMessageType } from '@jupyterlab/services/lib/kernel/messages';
import { injectable, inject } from 'inversify';
import { Disposable, NotebookDocument, NotebookEditor, NotebookRendererMessaging, notebooks } from 'vscode';
import { IKernel, IKernelProvider } from '../../../kernels/types';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { WIDGET_MIMETYPE } from '../../../platform/common/constants';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { IDisposable } from '../../../platform/common/types';
import { noop } from '../../../platform/common/utils/misc';

type WidgetData = {
    model_id: string;
};

type QueryWidgetStateCommand = { command: 'query-widget-state'; model_id: string };

@injectable()
export class IPyWidgetRendererComms implements IExtensionSyncActivationService {
    private readonly disposables: IDisposable[] = [];
    constructor(@inject(IKernelProvider) private readonly kernelProvider: IKernelProvider) {}
    private readonly widgetOutputsPerNotebook = new WeakMap<NotebookDocument, Set<string>>();
    public dispose() {
        disposeAllDisposables(this.disposables);
    }
    activate() {
        const comms = notebooks.createRendererMessaging('jupyter-ipywidget-renderer');
        comms.onDidReceiveMessage(this.onDidReceiveMessage.bind(this, comms), this, this.disposables);
        this.kernelProvider.onDidStartKernel(this.onDidStartKernel, this, this.disposables);
    }
    private onDidStartKernel(e: IKernel) {
        this.hookupKernel(e);
        e.onStarted(() => this.hookupKernel(e), this, this.disposables);
        e.onRestarted(() => this.hookupKernel(e), this, this.disposables);
    }
    private hookupKernel(kernel: IKernel) {
        this.widgetOutputsPerNotebook.delete(kernel.notebook);
        const previousKernelConnection = kernel.session?.kernel;
        const iopubMessage = kernel.session?.kernel?.iopubMessage;
        if (!iopubMessage) {
            return;
        }

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const jupyterLab = require('@jupyterlab/services') as typeof import('@jupyterlab/services');
        const handler = (kernelConnection: IKernelConnection, msg: IIOPubMessage<IOPubMessageType>) => {
            if (kernelConnection !== previousKernelConnection) {
                // Must be some old message from a previous kernel (before a restart or the like.)
                return;
            }

            if (
                jupyterLab.KernelMessage.isDisplayDataMsg(msg) ||
                jupyterLab.KernelMessage.isUpdateDisplayDataMsg(msg) ||
                jupyterLab.KernelMessage.isExecuteReplyMsg(msg) ||
                jupyterLab.KernelMessage.isExecuteResultMsg(msg)
            ) {
                this.trackModelId(kernel.notebook, msg);
            }
        };
        iopubMessage.connect(handler);
        this.disposables.push(new Disposable(() => iopubMessage.disconnect(handler)));
    }
    private trackModelId(
        notebook: NotebookDocument,
        msg: {
            content: {
                data: nbformat.IMimeBundle;
            };
        }
    ) {
        const output = msg.content;
        if (output.data && typeof output.data === 'object' && WIDGET_MIMETYPE in output.data) {
            const widgetData = output.data[WIDGET_MIMETYPE] as WidgetData;
            if (widgetData && 'model_id' in widgetData) {
                const set = this.widgetOutputsPerNotebook.get(notebook) || new Set<string>();
                set.add(widgetData.model_id);
                this.widgetOutputsPerNotebook.set(notebook, set);
            }
        }
    }
    private onDidReceiveMessage(
        comms: NotebookRendererMessaging,
        { editor, message }: { editor: NotebookEditor; message: QueryWidgetStateCommand }
    ) {
        if (message && typeof message === 'object' && message.command === 'query-widget-state') {
            this.queryWidgetState(comms, editor, message);
        }
    }
    private queryWidgetState(
        comms: NotebookRendererMessaging,
        editor: NotebookEditor,
        message: QueryWidgetStateCommand
    ) {
        const availableModels = this.widgetOutputsPerNotebook.get(editor.notebook);
        const available = !!availableModels?.has(message.model_id);
        comms
            .postMessage({ command: 'query-widget-state', model_id: message.model_id, available }, editor)
            .then(noop, noop);
    }
}
