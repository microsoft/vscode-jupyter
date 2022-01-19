// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as path from 'path';
import { inject, injectable, named } from 'inversify';
import {
    CancellationToken,
    CodeAction,
    CodeActionContext,
    CodeActionKind,
    CodeActionProvider,
    commands,
    Diagnostic,
    DiagnosticCollection,
    EventEmitter,
    FileDecoration,
    FileDecorationProvider,
    languages,
    Memento,
    Range,
    TextDocument,
    TextEditor,
    ThemeColor,
    Uri,
    window,
    workspace
} from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { disposeAllDisposables } from '../../common/helpers';
import { GLOBAL_MEMENTO, IDisposable, IMemento } from '../../common/types';
import { PYTHON_LANGUAGE } from '../../common/constants';
import { DiagnosticSeverity } from 'vscode-languageserver-protocol';
import { DataScience } from '../../common/utils/localize';
import { InterpreterPackages } from '../telemetry/interpreterPackages';
import { IPythonExtensionChecker } from '../../api/types';
import { BuiltInModules } from './constants';

const PYTHON_PACKAGES_MEMENTO_KEY = 'jupyter.pythonPackages';
@injectable()
export class ReservedFileNamesDiagnosticProvider
    implements IExtensionSingleActivationService, CodeActionProvider, FileDecorationProvider {
    private readonly disposables: IDisposable[] = [];
    private readonly diagnosticCollection: DiagnosticCollection;
    private readonly _onDidChangeFileDecorations = new EventEmitter<Uri | Uri[] | undefined>();
    private readonly ignoredFiles = new Set<string>();
    private readonly cachedModules = new Set<string>();
    onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;
    constructor(
        @inject(InterpreterPackages) private readonly packages: InterpreterPackages,
        @inject(IPythonExtensionChecker) private extensionChecker: IPythonExtensionChecker,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private cache: Memento
    ) {
        this.diagnosticCollection = languages.createDiagnosticCollection('Reserved Python Filenames');
        this.cachedModules = new Set(
            this.cache.get<string[]>(PYTHON_PACKAGES_MEMENTO_KEY, BuiltInModules).map((item) => item.toLowerCase())
        );
    }
    public dispose() {
        disposeAllDisposables(this.disposables);
        this._onDidChangeFileDecorations.dispose();
        this.diagnosticCollection.dispose();
    }
    public async activate(): Promise<void> {
        if (!this.extensionChecker.isPythonExtensionInstalled) {
            return;
        }
        this.disposables.push(languages.registerCodeActionsProvider(PYTHON_LANGUAGE, this));
        this.disposables.push(window.registerFileDecorationProvider(this));
        window.onDidChangeActiveTextEditor(this.provideDiagnosticsForEditor, this, this.disposables);
        workspace.onDidCloseTextDocument((e) => this.diagnosticCollection.delete(e.uri), this, this.disposables);
        window.visibleTextEditors.forEach((editor) => this.provideDiagnosticsForEditor(editor));
        this.disposables.push(
            commands.registerCommand(
                'jupyter.ignoreReservedFileNamesDiagnostic',
                this.ignoreReservedFileNamesDiagnostic,
                this
            )
        );
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
            command: 'jupyter.ignoreReservedFileNamesDiagnostic',
            arguments: [document.uri],
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

    public async provideFileDecoration(uri: Uri, _token: CancellationToken): Promise<FileDecoration | undefined> {
        if (!uri.fsPath.toLowerCase().endsWith('.py')) {
            return;
        }
        const ourDiagnostic = this.diagnosticCollection.get(uri);
        if (ourDiagnostic && ourDiagnostic.length > 0) {
            return new FileDecoration('!', ourDiagnostic[0].message, new ThemeColor('editorWarning.foreground'));
        }

        if (await this.overridesPythonPackage(uri)) {
            const diagnostic = new Diagnostic(
                new Range(0, 0, 0, 0),
                DataScience.pythonFileOverridesPythonPackage(),
                DiagnosticSeverity.Warning
            );
            diagnostic.source = `Jupyter`;
            this.diagnosticCollection.set(uri, [diagnostic]);
            return new FileDecoration('!', diagnostic.message, new ThemeColor('editorWarning.foreground'));
        }
    }

    private async provideDiagnosticsForEditor(editor?: TextEditor) {
        if (!editor || editor.document.languageId !== PYTHON_LANGUAGE) {
            return;
        }
        if (await this.overridesPythonPackage(editor.document.uri)) {
            const lastLine = editor.document.lineCount;
            const diagnostic = new Diagnostic(
                new Range(0, 0, lastLine, editor.document.lineAt(lastLine - 1).range.end.character),
                DataScience.pythonFileOverridesPythonPackage(),
                DiagnosticSeverity.Warning
            );
            diagnostic.source = `Jupyter`;
            this.diagnosticCollection.delete(editor.document.uri);
            this.diagnosticCollection.set(editor.document.uri, [diagnostic]);
            this._onDidChangeFileDecorations.fire(editor.document.uri);
        }
    }
    private async overridesPythonPackage(uri: Uri): Promise<boolean> {
        if (this.ignoredFiles.has(uri.fsPath)) {
            return false;
        }
        const filePath = uri.fsPath.toLowerCase();
        // If this file is in a site_packages folder, then get out.
        // Any file in <python env>/lib/python<version> is a reserved file.
        const foldersToIgnore = ['site-packages', `lib${path.sep}python`, `lib64${path.sep}python`];
        if (foldersToIgnore.some((item) => filePath.includes(item))) {
            return false;
        }
        if (this.cache.get<string[]>(PYTHON_PACKAGES_MEMENTO_KEY, BuiltInModules)) {
        }
        const possibleModule = path.basename(uri.fsPath, path.extname(uri.fsPath)).toLowerCase();
        if (this.cachedModules.has(possibleModule)) {
            return true;
        }

        const packages = await this.packages.listPackages(uri);
        const previousCount = this.cachedModules.size;
        packages.forEach((item) => this.cachedModules.add(item));
        if (previousCount < this.cachedModules.size) {
            void this.cache.update(PYTHON_PACKAGES_MEMENTO_KEY, Array.from(this.cachedModules));
        }
        return packages.has(possibleModule);
    }
    private ignoreReservedFileNamesDiagnostic(uri: Uri) {
        this.ignoredFiles.add(uri.fsPath);
        this.diagnosticCollection.delete(uri);
        this._onDidChangeFileDecorations.fire(uri);
        const fileName = path.basename(uri.fsPath);
        void window.showInformationMessage(
            `File '${fileName}' allowed to override Python Packages.`,
            'Revert this action'
        );
    }
}
