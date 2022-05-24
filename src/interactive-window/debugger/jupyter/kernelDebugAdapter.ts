// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { KernelMessage } from '@jupyterlab/services';
import * as path from '../../../platform/vscode-path/path';
import { DebugAdapterTracker, DebugSession, NotebookDocument, Uri } from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import { IJupyterSession, IKernel } from '../../../kernels/types';
import { IPlatformService } from '../../../platform/common/platform/types';
import { IDumpCellResponse, IDebugLocationTrackerFactory } from '../../../kernels/debugger/types';
import { traceError, traceInfoIfCI } from '../../../platform/logging';
import { getInteractiveCellMetadata } from '../../../interactive-window/helpers';
import { KernelDebugAdapterBase } from '../../../kernels/debugger/kernelDebugAdapterBase';

export class KernelDebugAdapter extends KernelDebugAdapterBase {
    private readonly debugLocationTracker?: DebugAdapterTracker;
    constructor(
        session: DebugSession,
        notebookDocument: NotebookDocument,
        jupyterSession: IJupyterSession,
        kernel: IKernel | undefined,
        platformService: IPlatformService,
        debugLocationTrackerFactory?: IDebugLocationTrackerFactory
    ) {
        super(session, notebookDocument, jupyterSession, kernel, platformService);
        if (debugLocationTrackerFactory) {
            this.debugLocationTracker = debugLocationTrackerFactory.createDebugAdapterTracker(
                session
            ) as DebugAdapterTracker;
            if (this.debugLocationTracker.onWillStartSession) {
                this.debugLocationTracker.onWillStartSession();
            }
            this.onDidSendMessage(
                (msg) => {
                    if (this.debugLocationTracker?.onDidSendMessage) {
                        this.debugLocationTracker.onDidSendMessage(msg);
                    }
                },
                this,
                this.disposables
            );
            this.onDidEndSession(
                () => {
                    if (this.debugLocationTracker?.onWillStopSession) {
                        this.debugLocationTracker.onWillStopSession();
                    }
                },
                this,
                this.disposables
            );
        }
    }

    override handleMessage(message: DebugProtocol.ProtocolMessage): Promise<KernelMessage.IDebugReplyMsg | undefined> {
        traceInfoIfCI(`KernelDebugAdapter::handleMessage ${JSON.stringify(message, undefined, ' ')}`);
        if (message.type === 'request' && this.debugLocationTracker?.onWillReceiveMessage) {
            this.debugLocationTracker.onWillReceiveMessage(message);
        }
        if (message.type === 'response' && this.debugLocationTracker?.onDidSendMessage) {
            this.debugLocationTracker.onDidSendMessage(message);
        }
        return super.handleMessage(message);
    }

    // Dump content of given cell into a tmp file and return path to file.
    protected async dumpCell(index: number): Promise<void> {
        const cell = this.notebookDocument.cellAt(index);
        const metadata = getInteractiveCellMetadata(cell);
        if (!metadata) {
            throw new Error('Not an interactive window cell');
        }
        try {
            const response = await this.session.customRequest('dumpCell', {
                code: (metadata.generatedCode?.code || cell.document.getText()).replace(/\r\n/g, '\n')
            });
            const norm = path.normalize((response as IDumpCellResponse).sourcePath);
            this.fileToCell.set(norm, {
                uri: Uri.parse(metadata.interactive.uristring),
                lineOffset:
                    metadata.interactive.lineIndex +
                    (metadata.generatedCode?.lineOffsetRelativeToIndexOfFirstLineInCell || 0)
            });
            this.cellToFile.set(Uri.parse(metadata.interactive.uristring), {
                path: norm,
                lineOffset:
                    metadata.interactive.lineIndex +
                    (metadata.generatedCode?.lineOffsetRelativeToIndexOfFirstLineInCell || 0)
            });
        } catch (err) {
            traceError(`Failed to dump cell for ${cell.index} with code ${metadata.interactive.originalSource}`, err);
        }
    }
}
