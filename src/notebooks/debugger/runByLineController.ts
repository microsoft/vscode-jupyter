// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from '../../platform/vscode-path/path';
import { DebugProtocolMessage, NotebookCell } from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import { ICommandManager } from '../../platform/common/application/types';
import { IKernel } from '../../kernels/types';
import { IConfigurationService } from '../../platform/common/types';
import { sendTelemetryEvent } from '../../telemetry';
import { DebuggingTelemetry } from './constants';
import { traceInfoIfCI, traceVerbose } from '../../platform/logging';
import { noop } from '../../platform/common/utils/misc';
import { Commands } from '../../platform/common/constants';
import { cellDebugSetup } from './helper';
import { IDebuggingDelegate, IKernelDebugAdapter, KernelDebugMode } from './debuggingTypes';
import { parseForComments } from '../../platform/common/utils';

/**
 * Listens to event when doing run by line and controls the behavior of the debugger (like auto stepping on moving out of a cell)
 */
export class RunByLineController implements IDebuggingDelegate {
    private lastPausedThreadId: number | undefined;

    constructor(
        private readonly debugAdapter: IKernelDebugAdapter,
        public readonly debugCell: NotebookCell,
        private readonly commandManager: ICommandManager,
        private readonly kernel: IKernel,
        private readonly settings: IConfigurationService
    ) {
        sendTelemetryEvent(DebuggingTelemetry.successfullyStartedRunByLine);
    }

    public continue(): void {
        if (typeof this.lastPausedThreadId !== 'number') {
            traceVerbose(`No paused thread, can't do RBL`);
            this.stop();
            return;
        }

        this.debugAdapter.stepIn(this.lastPausedThreadId).then(noop, noop);
    }

    public stop(): void {
        traceInfoIfCI(`RunbylineController::stop()`);
        // When debugpy gets stuck, running a cell fixes it and allows us to start another debugging session
        this.kernel.executeHidden('pass').then(noop, noop);
        this.debugAdapter.disconnect().then(noop, noop);
    }

    public getMode(): KernelDebugMode {
        const config = this.debugAdapter.getConfiguration();
        return config.__mode;
    }

    public async willSendEvent(msg: DebugProtocolMessage): Promise<boolean> {
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

    public async willSendRequest(request: DebugProtocol.Request): Promise<void> {
        traceInfoIfCI(`willSendRequest: ${request.command}`);
        if (request.command === 'configurationDone') {
            await this.initializeExecute();
        }
    }

    private async handleStoppedEvent(threadId: number): Promise<boolean> {
        if (await this.shouldStepIn(threadId)) {
            this.debugAdapter.stepIn(threadId).then(noop, noop);
            return true;
        }

        return false;
    }

    private async shouldStepIn(threadId: number): Promise<boolean> {
        // Call stackTrace to determine whether to forward the stop event to the client, and also to
        // start the process of updating the variables view.
        const stResponse = await this.debugAdapter.stackTrace({ threadId, startFrame: 0, levels: 1 });

        if (stResponse && stResponse.stackFrames[0]) {
            const sf = stResponse.stackFrames[0];
            return !!sf.source && sf.source.path !== this.debugCell.document.uri.toString();
        }

        return false;
    }

    private trace(tag: string, msg: string) {
        traceVerbose(`[Debug-RBL] ${tag}: ${msg}`);
    }

    private async initializeExecute() {
        await cellDebugSetup(this.kernel, this.debugAdapter);

        // This will save the code lines of the cell in lineList (so ignore comments and emtpy lines)
        // Its done to set the Run by Line breakpoint on the first code line
        const textLines = this.debugCell.document.getText().splitLines({ trim: false, removeEmptyEntries: false });
        const lineList: number[] = [];
        parseForComments(
            textLines,
            () => noop(),
            (s, i) => {
                if (s.trim().length !== 0) {
                    lineList.push(i);
                }
            }
        );
        lineList.sort();

        // Don't send the SetBreakpointsRequest or open the variable view if there are no code lines
        if (lineList.length !== 0) {
            const initialBreakpoint: DebugProtocol.SourceBreakpoint = {
                line: lineList[0] + 1
            };
            await this.debugAdapter.setBreakpoints({
                source: {
                    name: path.basename(this.debugCell.notebook.uri.path),
                    path: this.debugCell.document.uri.toString()
                },
                breakpoints: [initialBreakpoint],
                sourceModified: false
            });

            // Open variables view
            const settings = this.settings.getSettings();
            if (settings.showVariableViewWhenDebugging) {
                this.commandManager.executeCommand(Commands.OpenVariableView).then(noop, noop);
            }
        }

        // Run cell
        this.commandManager
            .executeCommand('notebook.cell.execute', {
                ranges: [{ start: this.debugCell.index, end: this.debugCell.index + 1 }],
                document: this.debugCell.document.uri
            })
            .then(noop, noop);
    }
}
