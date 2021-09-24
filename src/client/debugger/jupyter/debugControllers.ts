// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as path from 'path';
import { DebugProtocolMessage, NotebookCell } from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import { parseForComments } from '../../../datascience-ui/common';
import { ICommandManager } from '../../common/application/types';
import { traceVerbose } from '../../common/logger';
import { IConfigurationService } from '../../common/types';
import { noop } from '../../common/utils/misc';
import { Commands } from '../../datascience/constants';
import { IKernel } from '../../datascience/jupyter/kernels/types';
import { sendTelemetryEvent } from '../../telemetry';
import { DebuggingTelemetry } from '../constants';
import { IDebuggingDelegate, IKernelDebugAdapter, KernelDebugMode } from '../types';

export class DebugCellController implements IDebuggingDelegate {
    constructor(
        private readonly debugAdapter: IKernelDebugAdapter,
        public readonly debugCell: NotebookCell,
        private readonly kernel: IKernel,
        private readonly commandManager: ICommandManager
    ) {
        sendTelemetryEvent(DebuggingTelemetry.successfullyStartedRunAndDebugCell);
    }

    public async willSendEvent(_msg: DebugProtocolMessage): Promise<boolean> {
        return false;
    }

    public async willSendRequest(request: DebugProtocol.Request): Promise<void> {
        if (request.command === 'configurationDone') {
            await cellDebugSetup(this.kernel, this.debugAdapter, this.debugCell);

            void this.commandManager.executeCommand('notebook.cell.execute', {
                ranges: [{ start: this.debugCell.index, end: this.debugCell.index + 1 }],
                document: this.debugCell.document.uri
            });
        }
    }
}

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

        void this.debugAdapter.stepIn(this.lastPausedThreadId);
    }

    public stop(): void {
        // When debugpy gets stuck, running a cell fixes it and allows us to start another debugging session
        void this.kernel.executeHidden('pass');
        this.debugAdapter.disconnect();
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
        if (request.command === 'configurationDone') {
            await this.initializeExecute();
        }
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
        await cellDebugSetup(this.kernel, this.debugAdapter, this.debugCell);

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

            // Open variable view
            const settings = this.settings.getSettings();
            if (settings.showVariableViewWhenDebugging) {
                void this.commandManager.executeCommand(Commands.OpenVariableView);
            }
        }

        // Run cell
        void this.commandManager.executeCommand('notebook.cell.execute', {
            ranges: [{ start: this.debugCell.index, end: this.debugCell.index + 1 }],
            document: this.debugCell.document.uri
        });
    }
}

async function cellDebugSetup(
    kernel: IKernel,
    debugAdapter: IKernelDebugAdapter,
    debugCell: NotebookCell
): Promise<void> {
    // remove this if when https://github.com/microsoft/debugpy/issues/706 is fixed and ipykernel ships it
    // executing this code restarts debugpy and fixes https://github.com/microsoft/vscode-jupyter/issues/7251
    const code = 'import debugpy\ndebugpy.debug_this_thread()';
    await kernel.executeHidden(code);

    await debugAdapter.dumpCell(debugCell.index);
}
