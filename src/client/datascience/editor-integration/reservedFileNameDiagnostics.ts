// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as path from 'path';
import { inject, injectable } from 'inversify';
import {
    CodeAction,
    CodeActionContext,
    CodeActionKind,
    CodeActionProvider,
    Diagnostic,
    DiagnosticCollection,
    languages,
    Range,
    TextDocument,
    TextEditor,
    Uri
} from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { IDocumentManager } from '../../common/application/types';
import { disposeAllDisposables } from '../../common/helpers';
import { IDisposable } from '../../common/types';
import { PYTHON_LANGUAGE } from '../../common/constants';
import { DiagnosticSeverity } from 'vscode-languageserver-protocol';
import { DataScience } from '../../common/utils/localize';
import { InterpreterPackages } from '../telemetry/interpreterPackages';

@injectable()
export class ReservedFileNamesDiagnosticProvider implements IExtensionSingleActivationService, CodeActionProvider {
    private readonly disposables: IDisposable[] = [];
    private readonly diagnosticCollection: DiagnosticCollection;
    constructor(
        @inject(InterpreterPackages) private readonly packages: InterpreterPackages,
        @inject(IDocumentManager) private readonly documentManager: IDocumentManager
    ) {
        this.diagnosticCollection = languages.createDiagnosticCollection('Reserved Python Filenames');
    }
    public dispose() {
        disposeAllDisposables(this.disposables);
        this.diagnosticCollection.dispose();
    }
    public async activate(): Promise<void> {
        this.disposables.push(languages.registerCodeActionsProvider(PYTHON_LANGUAGE, this));
        this.documentManager.onDidChangeActiveTextEditor(this.provideDiagnosticsForEditor, this, this.disposables);
        this.documentManager.onDidCloseTextDocument(
            (e) => {
                this.diagnosticCollection.delete(e.uri);
            },
            this,
            this.disposables
        );
        this.documentManager.visibleTextEditors.forEach((editor) => this.provideDiagnosticsForEditor(editor));
    }

    public async provideCodeActions(
        document: TextDocument,
        _range: Range,
        context: CodeActionContext
    ): Promise<CodeAction[]> {
        const ourDiagnostic = context.diagnostics.filter(
            (item) => item.message === DataScience.pythonFileOverridesPythonPackage()
        );
        if (ourDiagnostic.length === 0) {
            return [];
        }

        const name = path.basename(document.fileName, path.extname(document.fileName));
        const codeActionDisable = new CodeAction(
            DataScience.alwaysIgnoreWarningsAboutOverridingPythonPackages(),
            CodeActionKind.QuickFix
        );
        codeActionDisable.command = {
            command: 'disableReservedFileNamesDiagnostic',
            arguments: [document.uri],
            title: codeActionDisable.title
        };
        const codeActionIgnore = new CodeAction(
            DataScience.ignoreWarningAboutOverridingPythonPackage().format(name),
            CodeActionKind.QuickFix
        );
        codeActionIgnore.command = {
            command: 'IgnoreReservedFileNamesDiagnostic',
            arguments: [name],
            title: codeActionIgnore.title
        };
        const codeActionMoreAction = new CodeAction(
            DataScience.moreInfoAboutFileNamesOverridingPythonPackages(),
            CodeActionKind.QuickFix
        );
        codeActionMoreAction.command = {
            command: 'vscode.open',
            arguments: [Uri.parse('https://aka.ms/vscodejupytermatplotlibwidget')],
            title: codeActionMoreAction.title
        };
        codeActionMoreAction.isPreferred = true;

        const codeActions = [codeActionDisable, codeActionIgnore, codeActionMoreAction];
        codeActions.forEach((action) => (action.diagnostics = ourDiagnostic));
        return codeActions;
    }
    private async provideDiagnosticsForEditor(editor?: TextEditor) {
        if (!editor || editor.document.languageId !== PYTHON_LANGUAGE) {
            return;
        }
        const packages = await this.packages.listPackages(editor.document.uri);
        const fileName = path.basename(editor.document.fileName, path.extname(editor.document.fileName));
        if (packages.has(fileName.toLowerCase())) {
            const lastLine = editor.document.lineCount;
            const diagnostic = new Diagnostic(
                new Range(0, 0, lastLine, editor.document.lineAt(lastLine - 1).range.end.character),
                DataScience.pythonFileOverridesPythonPackage(),
                DiagnosticSeverity.Warning
            );
            diagnostic.source = `Jupyter`;
            this.diagnosticCollection.delete(editor.document.uri);
            this.diagnosticCollection.set(editor.document.uri, [diagnostic]);
        }
    }
}
