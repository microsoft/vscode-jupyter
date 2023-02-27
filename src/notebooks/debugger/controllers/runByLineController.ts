// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { NotebookCell, Position } from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import { INotebookKernelExecution } from '../../../kernels/types';
import { ICommandManager } from '../../../platform/common/application/types';
import { Commands } from '../../../platform/common/constants';
import { splitLines } from '../../../platform/common/helpers';
import { IConfigurationService } from '../../../platform/common/types';
import { parseForComments } from '../../../platform/common/utils';
import { noop } from '../../../platform/common/utils/misc';
import { traceInfoIfCI, traceVerbose } from '../../../platform/logging';
import * as path from '../../../platform/vscode-path/path';
import { sendTelemetryEvent } from '../../../telemetry';
import { DebuggingTelemetry } from '../constants';
import { IDebuggingDelegate, IKernelDebugAdapter, KernelDebugMode } from '../debuggingTypes';
import { cellDebugSetup } from '../helper';
import { isJustMyCodeNotification } from './debugCellController';

/**
 * Implements the business logic of RBL (like auto stepping on moving out of a cell)
 */
export class RunByLineController implements IDebuggingDelegate {
    private lastPausedThreadId: number | undefined;
    private lastPausePosition: Position | undefined;

    constructor(
        private readonly debugAdapter: IKernelDebugAdapter,
        public readonly debugCell: NotebookCell,
        private readonly commandManager: ICommandManager,
        private readonly execution: INotebookKernelExecution,
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
        this.execution.executeHidden('pass').then(noop, noop);
        this.debugAdapter.disconnect().then(noop, noop);
    }

    public getMode(): KernelDebugMode {
        const config = this.debugAdapter.getConfiguration();
        return config.__mode;
    }

    public async willSendEvent(msg: DebugProtocol.Event): Promise<boolean> {
        if (msg.event === 'stopped') {
            this.lastPausedThreadId = msg.body.threadId;
            if (await this.handleStoppedEvent(this.lastPausedThreadId!)) {
                this.trace('intercepted', 'handled stop event');
                return true;
            }
        }

        if (msg.event === 'output') {
            if (isJustMyCodeNotification(msg.body.output)) {
                this.trace('intercept', 'justMyCode notification');
                return true;
            }
        }

        return false;
    }

    public async willSendRequest(request: DebugProtocol.Request): Promise<undefined> {
        traceInfoIfCI(`willSendRequest: ${request.command}`);
        if (request.command === 'configurationDone') {
            await this.initializeExecute();
        }

        return undefined;
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
            const pausePos = new Position(sf.line, sf.column);
            if (this.lastPausePosition?.isEqual(pausePos)) {
                // This is a workaround for https://github.com/microsoft/debugpy/issues/1104
                this.trace('intercept', 'working around duplicate stop event');
                return true;
            }

            this.lastPausePosition = pausePos;
            return !!sf.source && sf.source.path !== this.debugCell.document.uri.toString();
        }

        return false;
    }

    private trace(tag: string, msg: string) {
        traceVerbose(`[Debug-RBL] ${tag}: ${msg}`);
    }

    private async initializeExecute() {
        await cellDebugSetup(this.execution, this.debugAdapter);

        // This will save the code lines of the cell in lineList (so ignore comments and emtpy lines)
        // Its done to set the Run by Line breakpoint on the first code line
        const textLines = splitLines(this.debugCell.document.getText(), { trim: false, removeEmptyEntries: false });
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
            const settings = this.settings.getSettings(this.debugCell.notebook.uri);
            if (settings.showVariableViewWhenDebugging) {
                this.commandManager.executeCommand(Commands.OpenVariableView).then(noop, noop);
            }
        }

        // Run cell
        this.commandManager
            .executeCommand('notebook.cell.execute', {
                ranges: [{ start: this.debugCell.index, end: this.debugCell.index + 1 }],
                document: this.debugCell.notebook.uri
            })
            .then(noop, noop);
    }
}
