// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Position, Range, TextEditor, Uri } from 'vscode';

import { IApplicationShell, IDocumentManager } from '../../common/application/types';
import { PYTHON_LANGUAGE } from '../../common/constants';
import { IServiceContainer } from '../../ioc/types';
import { ICodeExecutionHelper } from '../types';
import { noop } from '../../common/utils/misc';

/**
 * Handles trimming code sent to a terminal so it actually runs.
 */
export class CodeExecutionHelperBase implements ICodeExecutionHelper {
    protected readonly documentManager: IDocumentManager;
    private readonly applicationShell: IApplicationShell;

    constructor(serviceContainer: IServiceContainer) {
        this.documentManager = serviceContainer.get<IDocumentManager>(IDocumentManager);
        this.applicationShell = serviceContainer.get<IApplicationShell>(IApplicationShell);
    }

    public async normalizeLines(_code: string, _resource?: Uri): Promise<string> {
        throw Error('Not Implemented');
    }

    public async getFileToExecute(): Promise<Uri | undefined> {
        const activeEditor = this.documentManager.activeTextEditor;
        if (!activeEditor) {
            this.applicationShell.showErrorMessage('No open file to run in terminal').then(noop, noop);
            return;
        }
        if (activeEditor.document.isUntitled) {
            this.applicationShell
                .showErrorMessage('The active file needs to be saved before it can be run')
                .then(noop, noop);
            return;
        }
        if (activeEditor.document.languageId !== PYTHON_LANGUAGE) {
            this.applicationShell.showErrorMessage('The active file is not a Python source file').then(noop, noop);
            return;
        }
        if (activeEditor.document.isDirty) {
            await activeEditor.document.save();
        }
        return activeEditor.document.uri;
    }

    public getSelectedTextToExecute(textEditor: TextEditor): string | undefined {
        if (!textEditor) {
            return;
        }

        const selection = textEditor.selection;
        let code: string;
        if (selection.isEmpty) {
            code = textEditor.document.lineAt(selection.start.line).text;
        } else if (selection.isSingleLine) {
            code = this.getSingleLineSelectionText(textEditor);
        } else {
            code = this.getMultiLineSelectionText(textEditor);
        }
        return this.dedentCode(code.trimEnd());
    }

    public async saveFileIfDirty(file: Uri): Promise<void> {
        const docs = this.documentManager.textDocuments.filter((d) => d.uri.path === file.path);
        if (docs.length === 1 && docs[0].isDirty) {
            await docs[0].save();
        }
    }

    private dedentCode(code: string) {
        const lines = code.split('\n');
        const firstNonEmptyLine = lines.find((line) => line.trim().length > 0);
        if (firstNonEmptyLine) {
            const leadingSpaces = firstNonEmptyLine.match(/^\s*/)![0];
            return lines
                .map((line) => {
                    if (line.startsWith(leadingSpaces)) {
                        return line.replace(leadingSpaces, '');
                    }
                    return line;
                })
                .join('\n');
        }
        return code;
    }

    private getSingleLineSelectionText(textEditor: TextEditor): string {
        const selection = textEditor.selection;
        const selectionRange = new Range(selection.start, selection.end);
        const selectionText = textEditor.document.getText(selectionRange);
        const fullLineText = textEditor.document.lineAt(selection.start.line).text;

        if (selectionText.trim() === fullLineText.trim()) {
            // This handles the following case:
            // if (x):
            //     print(x)
            //     ↑------↑   <--- selection range
            //
            // We should return:
            //     print(x)
            // ↑----------↑    <--- text including the initial white space
            return fullLineText;
        }

        // This is where part of the line is selected:
        // if(isPrime(x) || isFibonacci(x)):
        //    ↑--------↑    <--- selection range
        //
        // We should return just the selection:
        // isPrime(x)
        return selectionText;
    }

    private getMultiLineSelectionText(textEditor: TextEditor): string {
        const selection = textEditor.selection;
        const selectionRange = new Range(selection.start, selection.end);
        const selectionText = textEditor.document.getText(selectionRange);

        const fullTextRange = new Range(
            new Position(selection.start.line, 0),
            new Position(selection.end.line, textEditor.document.lineAt(selection.end.line).text.length)
        );
        const fullText = textEditor.document.getText(fullTextRange);

        // This handles case where:
        // def calc(m, n):
        //     ↓<------------------------------- selection start
        //     print(m)
        //     print(n)
        //            ↑<------------------------ selection end
        //     if (m == 0):
        //         return n + 1
        //     if (m > 0 and n == 0):
        //         return calc(m - 1 , 1)
        //     return calc(m - 1, calc(m, n - 1))
        //
        // We should return:
        // ↓<---------------------------------- From here
        //     print(m)
        //     print(n)
        //            ↑<----------------------- To here
        if (selectionText.trim() === fullText.trim()) {
            return fullText;
        }

        const fullStartLineText = textEditor.document.lineAt(selection.start.line).text;
        const selectionFirstLineRange = new Range(
            selection.start,
            new Position(selection.start.line, fullStartLineText.length)
        );
        const selectionFirstLineText = textEditor.document.getText(selectionFirstLineRange);

        // This handles case where:
        // def calc(m, n):
        //     ↓<------------------------------ selection start
        //     if (m == 0):
        //         return n + 1
        //                ↑<------------------- selection end (notice " + 1" is not selected)
        //     if (m > 0 and n == 0):
        //         return calc(m - 1 , 1)
        //     return calc(m - 1, calc(m, n - 1))
        //
        // We should return:
        // ↓<---------------------------------- From here
        //     if (m == 0):
        //         return n + 1
        //                ↑<------------------- To here (notice " + 1" is not selected)
        if (selectionFirstLineText.trimStart() === fullStartLineText.trimStart()) {
            return fullStartLineText + selectionText.substring(selectionFirstLineText.length);
        }

        // If you are here then user has selected partial start and partial end lines:
        // def calc(m, n):

        //     if (m == 0):
        //         return n + 1

        //        ↓<------------------------------- selection start
        //     if (m > 0
        //         and n == 0):
        //                   ↑<-------------------- selection end
        //         return calc(m - 1 , 1)
        //     return calc(m - 1, calc(m, n - 1))
        //
        // We should return:
        // ↓<---------------------------------- From here
        // (m > 0
        //         and n == 0)
        //                   ↑<---------------- To here
        return selectionText;
    }
}
