// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { DebugProtocolMessage, Uri } from 'vscode';
import { traceVerbose } from '../../common/logger';
import { DebuggingDelegate, IKernelDebugAdapter } from '../types';

export class RunByLineController implements DebuggingDelegate {
    private lastPausedThreadId: number | undefined;

    constructor(private readonly debugAdapter: IKernelDebugAdapter, public readonly debugCellUri: Uri) {}

    public continue(): void {
        if (typeof this.lastPausedThreadId !== 'number') {
            traceVerbose(`No paused thread, can't do RBL`);
            return;
        }

        void this.debugAdapter.stepIn(this.lastPausedThreadId);
    }

    public stop(): void {
        this.debugAdapter.disconnect();
    }

    public async willSendMessage(msg: DebugProtocolMessage): Promise<boolean> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anyMsg = msg as any;

        if (anyMsg.content.event === 'stopped') {
            this.lastPausedThreadId = anyMsg.content.body.threadId;
            if (await this.handleStoppedEvent(this.lastPausedThreadId!)) {
                this.trace('intercepted', JSON.stringify(anyMsg.content));
                return true;
            }
        }

        return false;
    }

    private async handleStoppedEvent(threadId: number): Promise<boolean> {
        if (await this.shouldStepIn(threadId)) {
            void this.debugAdapter.stepIn(threadId);
            return true;
        }

        return false;
    }

    private async shouldStepIn(threadId: number): Promise<boolean> {
        // Call stackTrace to determine whether to forward the stop event to the client, and also to
        // start the process of updating the variables view.
        const stResponse = await this.debugAdapter.stackTrace({ threadId, startFrame: 0, levels: 1 });

        const sf = stResponse.stackFrames[0];
        return !!sf.source && sf.source.path !== this.debugCellUri.toString();
    }

    private trace(tag: string, msg: string) {
        traceVerbose(`[Debug-RBL] ${tag}: ${msg}`);
    }
}
