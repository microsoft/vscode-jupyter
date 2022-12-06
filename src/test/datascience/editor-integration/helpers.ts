// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import type * as nbformat from '@jupyterlab/nbformat';
import { anything, instance, mock, when } from 'ts-mockito';
import * as TypeMoq from 'typemoq';
import {
    NotebookDocument,
    NotebookCell,
    Range,
    TextDocument,
    TextLine,
    Uri,
    NotebookRange,
    NotebookCellData
} from 'vscode';
import { InteractiveWindowView, JupyterNotebookView, NotebookCellScheme } from '../../../platform/common/constants';

/* eslint-disable , no-trailing-spaces, no-multi-str */
// Disable whitespace / multiline as we use that to pass in our fake file strings

// Helper function to create a document and get line count and lines
export function createDocument(
    inputText: string,
    fileName: string,
    fileVersion: number,
    times: TypeMoq.Times,
    implementGetText?: boolean
): TypeMoq.IMock<TextDocument> {
    const document = TypeMoq.Mock.ofType<TextDocument>();

    // Split our string on newline chars
    const inputLines = inputText.split(/\r?\n/);

    const uri = Uri.file(fileName);

    document.setup((d) => d.languageId).returns(() => 'python');

    // First set the metadata
    document
        .setup((d) => d.uri)
        .returns(() => uri)
        .verifiable(times);
    // eslint-disable-next-line local-rules/dont-use-fspath
    document.setup((d) => d.fileName).returns(() => uri.fsPath);
    document
        .setup((d) => d.version)
        .returns(() => fileVersion)
        .verifiable(times);

    // Next add the lines in
    document.setup((d) => d.lineCount).returns(() => inputLines.length);

    const textLines = inputLines.map((line, index) => {
        const textLine = TypeMoq.Mock.ofType<TextLine>();
        const testRange = new Range(index, 0, index, line.length);
        textLine.setup((l) => l.text).returns(() => line);
        textLine.setup((l) => l.range).returns(() => testRange);
        textLine.setup((l) => l.isEmptyOrWhitespace).returns(() => line.trim().length === 0);
        return textLine;
    });
    document.setup((d) => d.lineAt(TypeMoq.It.isAnyNumber())).returns((index: number) => textLines[index].object);

    // Get text is a bit trickier
    if (implementGetText) {
        document.setup((d) => d.getText()).returns(() => inputText);
        document
            .setup((d) => d.getText(TypeMoq.It.isAny()))
            .returns((r: Range) => {
                let results = '';
                if (r) {
                    for (let line = r.start.line; line <= r.end.line && line < inputLines.length; line += 1) {
                        const startIndex = line === r.start.line ? r.start.character : 0;
                        const endIndex = line === r.end.line ? r.end.character : inputLines[line].length - 1;
                        results += inputLines[line].slice(startIndex, endIndex + 1);
                        if (line !== r.end.line) {
                            results += '\n';
                        }
                    }
                } else {
                    results = inputText;
                }
                return results;
            });
    }

    return document;
}

export function createMockedDocument(
    inputText: string,
    uri: Uri,
    fileVersion: number,
    implementGetText?: boolean
): TextDocument {
    const document = mock<TextDocument>();

    // Split our string on newline chars
    const inputLines = inputText.split(/\r?\n/);

    when(document.languageId).thenReturn('python');

    // First set the metadata
    when(document.uri).thenReturn(uri);
    // eslint-disable-next-line local-rules/dont-use-fspath
    when(document.fileName).thenReturn(uri.path);
    when(document.version).thenReturn(fileVersion);

    // Next add the lines in
    when(document.lineCount).thenReturn(inputLines.length);

    const textLines = inputLines.map((line, index) => {
        const textLine = mock<TextLine>();
        const testRange = new Range(index, 0, index, line.length);
        when(textLine.text).thenReturn(line);
        when(textLine.range).thenReturn(testRange);
        when(textLine.isEmptyOrWhitespace).thenReturn(line.trim().length === 0);
        return textLine;
    });
    when(document.lineAt(anything())).thenCall((index: number) => instance(textLines[index]));

    // Get text is a bit trickier
    if (implementGetText) {
        when(document.getText()).thenReturn(inputText);
        when(document.getText(anything())).thenCall((r: Range) => {
            let results = '';
            if (r) {
                for (let line = r.start.line; line <= r.end.line && line < inputLines.length; line += 1) {
                    const startIndex = line === r.start.line ? r.start.character : 0;
                    const endIndex = line === r.end.line ? r.end.character : inputLines[line].length - 1;
                    results += inputLines[line].slice(startIndex, endIndex + 1);
                    if (line !== r.end.line) {
                        results += '\n';
                    }
                }
            } else {
                results = inputText;
            }
            return results;
        });
    }

    return instance(document);
}

const defaultMetadata = {
    orig_nbformat: 1,
    kernelspec: {
        display_name: 'Hello',
        name: 'hello',
        language: 'python'
    },
    language_info: {
        name: 'python'
    }
};
export function createMockedNotebookDocument(
    cells: NotebookCellData[],
    metadata: Partial<nbformat.INotebookMetadata> = defaultMetadata,
    uri: Uri = Uri.file('foo.ipynb'),
    notebookType: typeof JupyterNotebookView | typeof InteractiveWindowView = JupyterNotebookView
): NotebookDocument {
    const notebook = mock<NotebookDocument>();
    const nbMetadata = JSON.parse(JSON.stringify(defaultMetadata));
    if (metadata.kernelspec) {
        Object.assign(nbMetadata.kernelspec, metadata.kernelspec);
    }
    if (metadata.language_info) {
        Object.assign(nbMetadata.language_info, metadata.language_info);
    }
    if (metadata.orig_nbformat) {
        nbMetadata.orig_nbformat = metadata.orig_nbformat;
    }
    const notebookContent: Partial<nbformat.INotebookContent> = {
        metadata: nbMetadata
    };
    when(notebook.notebookType).thenReturn(notebookType);
    when(notebook.metadata).thenReturn({ custom: notebookContent } as never);

    const nbCells = cells.map((data, index) => {
        const cell = mock<NotebookCell>();
        const mockedDocument = createMockedDocument(
            data.value,
            Uri.from({ scheme: NotebookCellScheme, fragment: index.toString(), path: uri.path }),
            1,
            true
        );
        when(cell.document).thenReturn(mockedDocument);
        when(cell.index).thenReturn(index);
        when(cell.kind).thenReturn(data.kind);
        when(cell.outputs).thenReturn([]);
        when(cell.notebook).thenReturn(instance(notebook));
        return instance(cell);
    });
    when(notebook.cellCount).thenReturn(nbCells.length);
    when(notebook.cellAt(anything())).thenCall((index) => nbCells[index]);
    when(notebook.getCells()).thenCall(() => nbCells);
    when(notebook.getCells(anything())).thenCall((range: NotebookRange) => nbCells.slice(range.start, range.end));
    return instance(notebook);
}
