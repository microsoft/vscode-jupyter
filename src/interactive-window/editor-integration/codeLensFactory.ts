// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { inject, injectable } from 'inversify';
import {
    CodeLens,
    Command,
    Event,
    EventEmitter,
    NotebookCellExecutionState,
    NotebookCellExecutionStateChangeEvent,
    Range,
    TextDocument
} from 'vscode';

import { IDocumentManager, IVSCodeNotebook, IWorkspaceService } from '../../platform/common/application/types';
import { traceWarning, traceInfoIfCI, traceVerbose } from '../../platform/logging';

import { ICellRange, IConfigurationService, IDisposableRegistry, Resource } from '../../platform/common/types';
import * as localize from '../../platform/common/utils/localize';
import { getInteractiveCellMetadata } from '../helpers';
import { IKernelProvider } from '../../kernels/types';
import { CodeLensCommands, Commands, InteractiveWindowView } from '../../platform/common/constants';
import { generateCellRangesFromDocument } from './cellFactory';
import { CodeLensPerfMeasures, ICodeLensFactory, IGeneratedCode, IGeneratedCodeStorageFactory } from './types';
import { StopWatch } from '../../platform/common/utils/stopWatch';

type CodeLensCacheData = {
    cachedDocumentVersion: number | undefined;
    cachedExecutionCounts: Set<number>;
    documentLenses: CodeLens[];
    cellRanges: ICellRange[];
    gotoCellLens: CodeLens[];
};

type PerNotebookData = {
    cellExecutionCounts: Map<string, number>;
    documentExecutionCounts: Map<string, number>;
};

// localized code lense text
const runCurrentandAllBelowTitle = localize.DataScience.runCurrentCellAndAddBelow;
const addCellBelowTitle = localize.DataScience.addCellBelowCommandTitle;
const debugCurrentCellTitle = localize.DataScience.debugCellCommandTitle;
const debugCellTitle = localize.DataScience.debugCellCommandTitle;
const debugStepOverTitle = localize.DataScience.debugStepOverCommandTitle;
const DebugContinueTitle = localize.DataScience.debugContinueCommandTitle;
const debugStopTitle = localize.DataScience.debugStopCommandTitle;
const runCellTitle = localize.DataScience.runCellLensCommandTitle;
const runAllCellsTitle = localize.DataScience.runAllCellsLensCommandTitle;
const runAllAboveTitle = localize.DataScience.runAllCellsAboveLensCommandTitle;
const runAllBelowTitle = localize.DataScience.runCellAndAllBelowLensCommandTitle;
const scrollToCellFormat = localize.DataScience.scrollToCellTitleFormatMessage;

/**
 * This class is a singleton that generates code lenses for any document the user opens. It listens
 * to cells being execute so it can add 'goto' lenses on cells that have already been run.
 */
@injectable()
export class CodeLensFactory implements ICodeLensFactory {
    private updateEvent: EventEmitter<void> = new EventEmitter<void>();
    private notebookData = new Map<string, PerNotebookData>();
    private codeLensCache = new Map<string, CodeLensCacheData>();
    private totalCodeLensUpdateTimeInMs: number = 0;
    private codeLensUpdateCount: number = 0;
    private maxCellCount: number = 0;

    constructor(
        @inject(IConfigurationService) private configService: IConfigurationService,
        @inject(IDocumentManager) private documentManager: IDocumentManager,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(IVSCodeNotebook) notebook: IVSCodeNotebook,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IGeneratedCodeStorageFactory)
        private readonly generatedCodeStorageFactory: IGeneratedCodeStorageFactory,
        @inject(IKernelProvider) kernelProvider: IKernelProvider
    ) {
        this.documentManager.onDidCloseTextDocument(this.onClosedDocument, this, disposables);
        this.workspace.onDidGrantWorkspaceTrust(() => this.codeLensCache.clear(), this, disposables);
        this.configService.getSettings(undefined).onDidChange(this.onChangedSettings, this, disposables);
        notebook.onDidChangeNotebookCellExecutionState(this.onDidChangeNotebookCellExecutionState, this, disposables);
        kernelProvider.onDidDisposeKernel(
            (kernel) => {
                this.notebookData.delete(kernel.notebook.uri.toString());
            },
            this,
            disposables
        );
    }

    public getPerfMeasures(): CodeLensPerfMeasures {
        return {
            totalCodeLensUpdateTimeInMs: this.totalCodeLensUpdateTimeInMs,
            codeLensUpdateCount: this.codeLensUpdateCount,
            maxCellCount: this.maxCellCount
        };
    }

    public get updateRequired(): Event<void> {
        return this.updateEvent.event;
    }

    public createCodeLenses(document: TextDocument): CodeLens[] {
        const cache = this.getCodeLensCacheData(document);
        return [...cache.documentLenses, ...cache.gotoCellLens];
    }

    public getCellRanges(document: TextDocument): ICellRange[] {
        const cache = this.getCodeLensCacheData(document);
        return cache.cellRanges;
    }

    private getCodeLensCacheData(document: TextDocument): CodeLensCacheData {
        const stopWatch = new StopWatch();
        let updated = false;

        // See if we have a cached version of the code lenses for this document
        const key = document.uri.toString();
        let cache = this.codeLensCache.get(key);
        let needUpdate = false;

        // If we don't have one, generate one
        if (!cache) {
            cache = {
                cachedDocumentVersion: undefined,
                cachedExecutionCounts: new Set<number>(),
                documentLenses: [],
                cellRanges: [],
                gotoCellLens: []
            };
            needUpdate = true;
            this.codeLensCache.set(key, cache);
        }

        // If the document version doesn't match, our cell ranges are out of date
        if (cache.cachedDocumentVersion !== document.version) {
            cache.cellRanges = generateCellRangesFromDocument(document, this.configService.getSettings(document.uri));

            // Because we have all new ranges, we need to recompute ALL of our code lenses.
            cache.documentLenses = [];
            cache.gotoCellLens = [];
            cache.cachedDocumentVersion = document.version;
            needUpdate = true;
        }

        // If the document execution count doesn't match, then our goto cell lenses are out of date
        const documentCounts = this.getDocumentExecutionCounts(key);
        if (
            documentCounts.length !== cache.cachedExecutionCounts.size ||
            documentCounts.find((n) => !cache?.cachedExecutionCounts.has(n))
        ) {
            cache.gotoCellLens = [];
            cache.cachedExecutionCounts = new Set<number>(documentCounts);
            needUpdate = true;
        }

        // Generate our code lenses if necessary
        if (cache.documentLenses.length === 0 && needUpdate && cache.cellRanges.length) {
            updated = true;
            // Enumerate the possible commands for the document based code lenses
            const commands = this.enumerateCommands(document.uri);
            traceVerbose(
                `CodeLensFactory: Generating new code lenses for version ${document.version} of document ${
                    document.uri
                } for commands ${commands.join(', ')}`
            );

            // Then iterate over all of the cell ranges and generate code lenses for each enabled command
            let firstCell = true;
            cache.cellRanges.forEach((r) => {
                commands.forEach((c) => {
                    const codeLens = this.createCodeLens(document, r, c, firstCell);
                    if (codeLens) {
                        cache!.documentLenses.push(codeLens);
                    }
                });
                firstCell = false;
            });
        } else {
            traceInfoIfCI(
                `NOT Generating new code lenses for version ${document.version} of document ${document.uri} - needUpdate: ${needUpdate}, cellRanges.length: ${cache.cellRanges.length}`
            );
        }

        // Generate the goto cell lenses if necessary
        if (
            needUpdate &&
            cache.gotoCellLens.length === 0 &&
            cache.cellRanges.length &&
            this.configService.getSettings(document.uri).addGotoCodeLenses
        ) {
            const storage = this.generatedCodeStorageFactory.get({ fileUri: document.uri });
            const generatedCodes = storage
                ? storage.all.find((item) => item.uri.toString() === document.uri.toString())?.generatedCodes
                : undefined;
            if (generatedCodes && generatedCodes.length) {
                cache.cellRanges.forEach((r) => {
                    const codeLens = this.createExecutionLens(document, r.range, generatedCodes);
                    if (codeLens) {
                        cache?.gotoCellLens.push(codeLens); // NOSONAR
                    }
                });
            }
        }

        if (updated) {
            this.totalCodeLensUpdateTimeInMs += stopWatch.elapsedTime;
            this.codeLensUpdateCount += 1;
            this.maxCellCount = Math.max(this.maxCellCount, cache.cellRanges.length);
        }

        return cache;
    }
    private getDocumentExecutionCounts(key: string): number[] {
        return [...this.notebookData.values()]
            .map((d) => d.documentExecutionCounts.get(key))
            .filter((n) => n !== undefined) as number[];
    }
    private onDidChangeNotebookCellExecutionState(e: NotebookCellExecutionStateChangeEvent) {
        if (e.cell.notebook.notebookType !== InteractiveWindowView) {
            return;
        }
        if (e.state !== NotebookCellExecutionState.Idle || !e.cell.executionSummary?.executionOrder) {
            return;
        }
        const metadata = getInteractiveCellMetadata(e.cell);
        let data = this.notebookData.get(e.cell.notebook.uri.toString());
        if (!data) {
            data = {
                cellExecutionCounts: new Map<string, number>(),
                documentExecutionCounts: new Map<string, number>()
            };
            this.notebookData.set(e.cell.notebook.uri.toString(), data);
        }
        if (data !== undefined && metadata !== undefined) {
            data.cellExecutionCounts.set(metadata.id, e.cell.executionSummary.executionOrder);
            data.documentExecutionCounts.set(metadata.interactive.uristring, e.cell.executionSummary.executionOrder);
            this.updateEvent.fire();
        }
    }
    private onClosedDocument(doc: TextDocument) {
        this.codeLensCache.delete(doc.uri.toString());

        // Don't delete the document execution count, we need to keep track
        // of it past the closing of a doc if the notebook or interactive window is still open.
    }

    private onChangedSettings() {
        // When config settings change, refresh our code lenses.
        this.codeLensCache.clear();

        // Force an update so that code lenses are recomputed now and not during execution.
        this.updateEvent.fire();
    }

    private enumerateCommands(resource: Resource): string[] {
        let fullCommandList: string[];
        // Add our non-debug commands
        const commands = this.configService.getSettings(resource).codeLenses;
        if (commands) {
            fullCommandList = commands.split(',').map((s) => s.trim());
        } else {
            fullCommandList = CodeLensCommands.DefaultDesignLenses;
        }

        // Add our debug commands
        const debugCommands = this.configService.getSettings(resource).debugCodeLenses;
        if (debugCommands) {
            fullCommandList = fullCommandList.concat(debugCommands.split(',').map((s) => s.trim()));
        } else {
            fullCommandList = fullCommandList.concat(CodeLensCommands.DefaultDebuggingLenses);
        }

        let commandsToBeDisabled: string[] = [];
        // If workspace is not trusted, then exclude execution related commands.
        if (!this.workspace.isTrusted) {
            commandsToBeDisabled = [
                ...CodeLensCommands.DebuggerCommands,
                ...CodeLensCommands.DebuggerCommands,
                Commands.RunAllCells,
                Commands.RunAllCellsAbove,
                Commands.RunAllCellsAbovePalette,
                Commands.RunCellAndAllBelowPalette,
                Commands.RunCurrentCell,
                Commands.RunCurrentCellAdvance,
                Commands.RunCurrentCellAndAddBelow,
                Commands.RunFileInInteractiveWindows,
                Commands.InterruptKernel,
                Commands.RunToLine,
                Commands.RunCell,
                Commands.DebugCell,
                Commands.DebugContinue,
                Commands.DebugStepOver,
                Commands.DebugStop,
                Commands.RunCellAndAllBelowPalette
            ];
        }
        if (commandsToBeDisabled) {
            fullCommandList = fullCommandList.filter((item) => !commandsToBeDisabled.includes(item));
        }
        return fullCommandList;
    }

    // eslint-disable-next-line
    private createCodeLens(
        document: TextDocument,
        cellRange: { range: Range; cell_type: string },
        commandName: string,
        isFirst: boolean
    ): CodeLens | undefined {
        // We only support specific commands
        // Be careful here. These arguments will be serialized during liveshare sessions
        // and so shouldn't reference local objects.
        const { range, cell_type } = cellRange;
        switch (commandName) {
            case Commands.RunCurrentCellAndAddBelow:
                return this.generateCodeLens(range, Commands.RunCurrentCellAndAddBelow, runCurrentandAllBelowTitle);
            case Commands.AddCellBelow:
                return this.generateCodeLens(range, Commands.AddCellBelow, addCellBelowTitle, [
                    document.uri,
                    range.start.line
                ]);
            case Commands.DebugCurrentCellPalette:
                return this.generateCodeLens(range, Commands.DebugCurrentCellPalette, debugCurrentCellTitle);

            case Commands.DebugCell:
                // If it's not a code cell (e.g. markdown), don't add the "Debug cell" action.
                if (cell_type !== 'code') {
                    break;
                }
                return this.generateCodeLens(range, Commands.DebugCell, debugCellTitle, [
                    document.uri,
                    range.start.line,
                    range.start.character,
                    range.end.line,
                    range.end.character
                ]);

            case Commands.DebugStepOver:
                // Only code cells get debug actions
                if (cell_type !== 'code') {
                    break;
                }
                return this.generateCodeLens(range, Commands.DebugStepOver, debugStepOverTitle, [document.uri]);

            case Commands.DebugContinue:
                // Only code cells get debug actions
                if (cell_type !== 'code') {
                    break;
                }
                return this.generateCodeLens(range, Commands.DebugContinue, DebugContinueTitle, [document.uri]);

            case Commands.DebugStop:
                // Only code cells get debug actions
                if (cell_type !== 'code') {
                    break;
                }
                return this.generateCodeLens(range, Commands.DebugStop, debugStopTitle, [document.uri]);

            case Commands.RunCurrentCell:
            case Commands.RunCell:
                return this.generateCodeLens(range, Commands.RunCell, runCellTitle, [
                    document.uri,
                    range.start.line,
                    range.start.character,
                    range.end.line,
                    range.end.character
                ]);

            case Commands.RunAllCells:
                return this.generateCodeLens(range, Commands.RunAllCells, runAllCellsTitle, [
                    document.uri,
                    range.start.line,
                    range.start.character
                ]);

            case Commands.RunAllCellsAbovePalette:
            case Commands.RunAllCellsAbove:
                if (!isFirst) {
                    return this.generateCodeLens(range, Commands.RunAllCellsAbove, runAllAboveTitle, [
                        document.uri,
                        range.start.line,
                        range.start.character
                    ]);
                } else {
                    return this.generateCodeLens(range, Commands.RunCellAndAllBelow, runAllBelowTitle, [
                        document.uri,
                        range.start.line,
                        range.start.character
                    ]);
                }
                break;
            case Commands.RunCellAndAllBelowPalette:
            case Commands.RunCellAndAllBelow:
                return this.generateCodeLens(range, Commands.RunCellAndAllBelow, runAllBelowTitle, [
                    document.uri,
                    range.start.line,
                    range.start.character
                ]);

            default:
                traceWarning(`Invalid command for code lens ${commandName}`);
                break;
        }

        return undefined;
    }

    private findMatchingCellExecutionCount(cellId: string) {
        // Cell ids on interactive window are generated on the fly so there shouldn't be dupes
        const data = [...this.notebookData.values()].find((d) => d.cellExecutionCounts.get(cellId));
        return data?.cellExecutionCounts.get(cellId);
    }

    private createExecutionLens(document: TextDocument, range: Range, generatedCodes: IGeneratedCode[]) {
        if (generatedCodes) {
            // Match just the start of the range. Should be - 2 (1 for 1 based numbers and 1 for skipping the comment at the top)
            const rangeMatches = generatedCodes
                .filter((h) => h.line - 2 === range.start.line)
                .sort((a, b) => a.timestamp - b.timestamp);
            if (rangeMatches && rangeMatches.length) {
                const rangeMatch = rangeMatches[rangeMatches.length - 1];
                const matchingExecutionCount = this.findMatchingCellExecutionCount(rangeMatch.id);
                if (matchingExecutionCount !== undefined) {
                    return this.generateCodeLens(
                        range,
                        Commands.ScrollToCell,
                        scrollToCellFormat(matchingExecutionCount),
                        [document.uri, rangeMatch.id]
                    );
                }
            }
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private generateCodeLens(range: Range, commandName: string, title: string, args?: any[]): CodeLens {
        return new CodeLens(range, generateCommand(commandName, title, args));
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function generateCommand(commandName: string, title: string, args?: any[]): Command {
    return {
        arguments: args,
        title,
        command: commandName
    };
}
