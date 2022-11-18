// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { Event, CodeLens, CodeLensProvider, Uri, TextEditor, Range, TextDocument, NotebookDocument } from 'vscode';
import { ICellRange, IDisposable } from '../../platform/common/types';

// Wraps the vscode CodeLensProvider base class
export const IDataScienceCodeLensProvider = Symbol('IDataScienceCodeLensProvider');
export interface IDataScienceCodeLensProvider extends CodeLensProvider {
    getCodeWatcher(document: TextDocument): ICodeWatcher | undefined;
}

export type CodeLensPerfMeasures = {
    totalCodeLensUpdateTimeInMs: number;
    codeLensUpdateCount: number;
    maxCellCount: number;
};

// Wraps the Code Watcher API
export const ICodeWatcher = Symbol('ICodeWatcher');
export interface ICodeWatcher extends IDisposable {
    readonly uri: Uri | undefined;
    codeLensUpdated: Event<void>;
    setDocument(document: TextDocument): void;
    getVersion(): number;
    getCodeLenses(): CodeLens[];
    runAllCells(): Promise<void>;
    runCell(range: Range): Promise<void>;
    debugCell(range: Range): Promise<void>;
    runCurrentCell(): Promise<void>;
    runCurrentCellAndAdvance(): Promise<void>;
    runSelectionOrLine(activeEditor: TextEditor | undefined, text: string | undefined): Promise<void>;
    runToLine(targetLine: number): Promise<void>;
    runFromLine(targetLine: number): Promise<void>;
    runAllCellsAbove(stopLine: number, stopCharacter: number): Promise<void>;
    runCellAndAllBelow(startLine: number, startCharacter: number): Promise<void>;
    runFileInteractive(): Promise<void>;
    debugFileInteractive(): Promise<void>;
    addEmptyCellToBottom(): Promise<void>;
    runCurrentCellAndAddBelow(): Promise<void>;
    insertCellBelowPosition(): void;
    insertCellBelow(): void;
    insertCellAbove(): void;
    deleteCells(): void;
    selectCell(): void;
    selectCellContents(): void;
    extendSelectionByCellAbove(): void;
    extendSelectionByCellBelow(): void;
    moveCellsUp(): Promise<void>;
    moveCellsDown(): Promise<void>;
    changeCellToMarkdown(): void;
    changeCellToCode(): void;
    debugCurrentCell(): Promise<void>;
    gotoNextCell(): void;
    gotoPreviousCell(): void;
}

export const ICodeLensFactory = Symbol('ICodeLensFactory');
export interface ICodeLensFactory {
    updateRequired: Event<void>;
    createCodeLenses(document: TextDocument): CodeLens[];
    getCellRanges(document: TextDocument): ICellRange[];
    getPerfMeasures(): CodeLensPerfMeasures;
}

export interface IGeneratedCode {
    /**
     * 1 based, excluding the cell marker.
     */
    line: number;
    endLine: number; // 1 based and inclusive
    runtimeLine: number; // Line in the jupyter source to start at
    runtimeFile: string; // Name of the cell's file
    executionCount: number;
    id: string; // Cell id as sent to jupyter
    timestamp: number;
    code: string; // Code that was actually hashed (might include breakpoint and other code)
    debuggerStartLine: number; // 1 based line in source .py that we start our file mapping from
    startOffset: number;
    endOffset: number;
    deleted: boolean;
    realCode: string;
    trimmedRightCode: string;
    firstNonBlankLineIndex: number; // zero based. First non blank line of the real code.
    lineOffsetRelativeToIndexOfFirstLineInCell: number;
    hasCellMarker: boolean;
}

export interface IFileGeneratedCodes {
    uri: Uri;
    generatedCodes: IGeneratedCode[];
}

export const IGeneratedCodeStore = Symbol('IGeneratedCodeStore');
export interface IGeneratedCodeStore {
    clear(): void;
    readonly all: IFileGeneratedCodes[];
    getFileGeneratedCode(fileUri: Uri): IGeneratedCode[];
    store(fileUri: Uri, info: IGeneratedCode): void;
}

export const IGeneratedCodeStorageFactory = Symbol('IGeneratedCodeStorageFactory');
export interface IGeneratedCodeStorageFactory {
    getOrCreate(notebook: NotebookDocument): IGeneratedCodeStore;
    get(options: { notebook: NotebookDocument } | { fileUri: Uri }): IGeneratedCodeStore | undefined;
}
export type InteractiveCellMetadata = {
    interactiveWindowCellMarker?: string;
    interactive: {
        uristring: string;
        lineIndex: number;
        originalSource: string;
    };
    generatedCode?: IGeneratedCode;
    id: string;
};

export interface IInteractiveWindowCodeGenerator extends IDisposable {
    reset(): void;
    generateCode(
        metadata: Pick<InteractiveCellMetadata, 'interactive' | 'id' | 'interactiveWindowCellMarker'>,
        cellIndex: number,
        debug: boolean,
        usingJupyterDebugProtocol?: boolean
    ): Promise<IGeneratedCode | undefined>;
}

export const ICodeGeneratorFactory = Symbol('ICodeGeneratorFactory');
export interface ICodeGeneratorFactory {
    getOrCreate(notebook: NotebookDocument): IInteractiveWindowCodeGenerator;
    get(notebook: NotebookDocument): IInteractiveWindowCodeGenerator | undefined;
}
