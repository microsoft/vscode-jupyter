// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { DebugAdapterTracker, DebugSession, NotebookDocument, Uri } from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import { getInteractiveCellMetadata } from '../../../interactive-window/helpers';
import { IKernel, IKernelConnectionSession } from '../../../kernels/types';
import { IDebugLocationTrackerFactory, IDumpCellResponse } from '../../../notebooks/debugger/debuggingTypes';
import { KernelDebugAdapterBase } from '../../../notebooks/debugger/kernelDebugAdapterBase';
import { IDebugService } from '../../../platform/common/application/types';
import { IPlatformService } from '../../../platform/common/platform/types';
import { traceError, traceInfo, traceInfoIfCI } from '../../../platform/logging';
import * as path from '../../../platform/vscode-path/path';
import { InteractiveCellMetadata } from '../../editor-integration/types';
/**
 * KernelDebugAdapter listens to debug messages in order to translate file requests into real files
 * (Interactive Window generally executes against a real file)
 * Files from the kernel are pointing to cells, whereas the user is looking at a real file.
 */
export class KernelDebugAdapter extends KernelDebugAdapterBase {
    private readonly debugLocationTracker?: DebugAdapterTracker;
    private readonly cellToDebugFileSortedInReverseOrderByLineNumber: {
        debugFilePath: string;
        interactiveWindow: Uri;
        lineOffset: number;
        metadata: InteractiveCellMetadata;
    }[] = [];

    constructor(
        session: DebugSession,
        notebookDocument: NotebookDocument,
        jupyterSession: IKernelConnectionSession,
        kernel: IKernel | undefined,
        platformService: IPlatformService,
        debugService: IDebugService,
        debugLocationTrackerFactory?: IDebugLocationTrackerFactory
    ) {
        super(session, notebookDocument, jupyterSession, kernel, platformService, debugService);
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

    override handleClientMessageAsync(message: DebugProtocol.ProtocolMessage): Promise<void> {
        traceInfoIfCI(`KernelDebugAdapter::handleMessage ${JSON.stringify(message, undefined, ' ')}`);
        if (message.type === 'request' && this.debugLocationTracker?.onWillReceiveMessage) {
            this.debugLocationTracker.onWillReceiveMessage(message);
        }
        if (message.type === 'response' && this.debugLocationTracker?.onDidSendMessage) {
            this.debugLocationTracker.onDidSendMessage(message);
        }
        return super.handleClientMessageAsync(message);
    }

    // Dump content of given cell into a tmp file and return path to file.
    protected async dumpCell(index: number): Promise<void> {
        const cell = this.notebookDocument.cellAt(index);
        const metadata = getInteractiveCellMetadata(cell);
        if (!metadata) {
            throw new Error('Not an interactive window cell');
        }
        try {
            const code = (metadata.generatedCode?.code || cell.document.getText()).replace(/\r\n/g, '\n');
            const response = await this.session.customRequest('dumpCell', { code });

            // We know jupyter will strip out leading white spaces, hence take that into account.
            const norm = path.normalize((response as IDumpCellResponse).sourcePath);
            this.fileToCell.set(norm, Uri.parse(metadata.interactive.uristring));

            // If this cell doesn't have a cell marker, then
            // Jupyter will strip out any leading whitespace.
            // Take that into account.
            let numberOfStrippedLines = 0;
            if (metadata.generatedCode && !metadata.generatedCode.hasCellMarker) {
                numberOfStrippedLines = metadata.generatedCode.firstNonBlankLineIndex;
            }
            this.cellToDebugFileSortedInReverseOrderByLineNumber.push({
                debugFilePath: norm,
                interactiveWindow: Uri.parse(metadata.interactive.uristring),
                metadata,
                lineOffset:
                    numberOfStrippedLines +
                    metadata.interactive.lineIndex +
                    (metadata.generatedCode?.lineOffsetRelativeToIndexOfFirstLineInCell || 0)
            });
            // Order cells in reverse order.
            this.cellToDebugFileSortedInReverseOrderByLineNumber.sort(
                (a, b) => b.metadata.interactive.lineIndex - a.metadata.interactive.lineIndex
            );
        } catch (err) {
            traceError(`Failed to dump cell for ${cell.index} with code ${metadata.interactive.originalSource}`, err);
        }
    }
    protected override translateDebuggerFileToRealFile(
        source: DebugProtocol.Source | undefined,
        lines?: { line?: number; endLine?: number; lines?: number[] }
    ) {
        if (!source || !source.path || !lines || (typeof lines.line !== 'number' && !Array.isArray(lines.lines))) {
            return;
        }
        // Find the cell that matches this line in the IW file by mapping the debugFilePath to the IW file.
        const cell = this.cellToDebugFileSortedInReverseOrderByLineNumber.find(
            (item) => item.debugFilePath === source.path
        );
        if (!cell) {
            return;
        }
        source.name = path.basename(cell.interactiveWindow.path);
        source.path = cell.interactiveWindow.toString();
        if (typeof lines?.endLine === 'number') {
            lines.endLine = lines.endLine + (cell.lineOffset || 0);
        }
        if (typeof lines?.line === 'number') {
            lines.line = lines.line + (cell.lineOffset || 0);
        }
        if (lines?.lines && Array.isArray(lines?.lines)) {
            lines.lines = lines?.lines.map((line) => line + (cell.lineOffset || 0));
        }
    }
    protected override translateRealFileToDebuggerFile(
        source: DebugProtocol.Source | undefined,
        lines?: { line?: number; endLine?: number; lines?: number[] }
    ) {
        if (!source || !source.path || !lines || (typeof lines.line !== 'number' && !Array.isArray(lines.lines))) {
            return;
        }
        const startLine = lines.line || lines.lines![0];
        // Find the cell that matches this line in the IW file by mapping the debugFilePath to the IW file.
        const cell = this.cellToDebugFileSortedInReverseOrderByLineNumber.find(
            (item) => startLine >= item.metadata.interactive.lineIndex + 1
        );
        if (!cell) {
            return;
        }
        source.path = cell.debugFilePath;
        if (typeof lines?.endLine === 'number') {
            lines.endLine = lines.endLine - (cell.lineOffset || 0);
        }
        if (typeof lines?.line === 'number') {
            lines.line = lines.line - (cell.lineOffset || 0);
        }
        if (lines?.lines && Array.isArray(lines?.lines)) {
            lines.lines = lines?.lines.map((line) => line - (cell.lineOffset || 0));
        }
    }

    protected override async sendRequestToJupyterSession(message: DebugProtocol.ProtocolMessage) {
        if (this.jupyterSession.disposed || this.jupyterSession.status === 'dead') {
            traceInfo(`Skipping sending message ${message.type} because session is disposed`);
            return;
        }

        const request = message as unknown as DebugProtocol.SetBreakpointsRequest;
        if (request.type === 'request' && request.command === 'setBreakpoints') {
            const sortedLines = (request.arguments.lines || []).concat(
                (request.arguments.breakpoints || []).map((bp) => bp.line)
            );
            const startLine = sortedLines.length ? sortedLines[0] : undefined;
            // Find the cell that matches this line in the IW file by mapping the debugFilePath to the IW file.
            const cell = startLine
                ? this.cellToDebugFileSortedInReverseOrderByLineNumber.find(
                      (item) => startLine >= item.metadata.interactive.lineIndex + 1
                  )
                : undefined;
            if (cell) {
                const clonedRequest: typeof request = JSON.parse(JSON.stringify(request));
                if (request.arguments.lines) {
                    request.arguments.lines = request.arguments.lines.filter(
                        (line) => line <= cell.metadata.generatedCode!.endLine
                    );
                }
                if (request.arguments.breakpoints) {
                    request.arguments.breakpoints = request.arguments.breakpoints.filter(
                        (bp) => bp.line <= cell.metadata.generatedCode!.endLine
                    );
                }
                if (sortedLines.filter((line) => line > cell.metadata.generatedCode!.endLine).length) {
                    // Find all the lines that don't belong to this cell & add breakpoints for those as well
                    // However do that separately as they belong to different files.
                    await this.setBreakpoints({
                        source: clonedRequest.arguments.source,
                        breakpoints: clonedRequest.arguments.breakpoints?.filter(
                            (bp) => bp.line > cell.metadata.generatedCode!.endLine
                        ),
                        lines: clonedRequest.arguments.lines?.filter(
                            (line) => line > cell.metadata.generatedCode!.endLine
                        )
                    });
                }
            }
        }

        return super.sendRequestToJupyterSession(message);
    }

    protected getDumpFilesForDeletion() {
        return this.cellToDebugFileSortedInReverseOrderByLineNumber.map((item) => item.debugFilePath);
    }
}
