// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import {
    CancellationToken,
    CodeAction,
    CodeActionContext,
    CodeActionKind,
    CodeActionProvider,
    commands,
    ConfigurationTarget,
    Diagnostic,
    DiagnosticCollection,
    DiagnosticSeverity,
    EventEmitter,
    FileDecoration,
    FileDecorationProvider,
    languages,
    Range,
    TextDocument,
    TextEditor,
    ThemeColor,
    Uri,
    window,
    workspace
} from 'vscode';
import { IDisposable } from '@fluentui/react';
import { IExtensionSingleActivationService } from '../../platform/activation/types';
import { PYTHON_LANGUAGE } from '../../platform/common/constants';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { Common, DataScience } from '../../platform/common/utils/localize';
import * as path from '../../platform/vscode-path/path';
import { IFileSystem } from '../../platform/common/platform/types';
import { IWorkspaceService } from '../../platform/common/application/types';
import { IReservedPythonNamedProvider } from '../../platform/interpreter/types';
import { JupyterKernelStartFailureOverrideReservedName } from '../../platform/interpreter/constants';
import { swallowExceptions } from '../../platform/common/utils/decorators';

export const enabledSettingName = 'diagnostics.reservedPythonNames.enabled';

/**
 * Generates errors when reserved names are used for files in the workspace
 */
@injectable()
export class ReservedFileNamesDiagnosticProvider
    implements IExtensionSingleActivationService, CodeActionProvider, FileDecorationProvider
{
    private readonly disposables: IDisposable[] = [];
    private readonly diagnosticCollection: DiagnosticCollection;
    private readonly _onDidChangeFileDecorations = new EventEmitter<Uri | Uri[] | undefined>();
    onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;
    private enabled: boolean;
    constructor(
        @inject(IReservedPythonNamedProvider) private readonly reservedNameProvider: IReservedPythonNamedProvider,
        @inject(IFileSystem) private readonly fileSystem: IFileSystem,
        @inject(IWorkspaceService) private workspace: IWorkspaceService
    ) {
        this.diagnosticCollection = languages.createDiagnosticCollection(
            DataScience.reservedPythonFileNamesDiagnosticCollectionName()
        );
    }
    public dispose() {
        disposeAllDisposables(this.disposables);
        this._onDidChangeFileDecorations.dispose();
        this.diagnosticCollection.dispose();
    }
    public async activate(): Promise<void> {
        this.disposables.push(languages.registerCodeActionsProvider(PYTHON_LANGUAGE, this));
        this.disposables.push(window.registerFileDecorationProvider(this));
        this.enabled = this.workspace.getConfiguration('jupyter').get<boolean>(enabledSettingName, true);
        this.workspace.onDidChangeConfiguration(
            (e) => {
                if (e.affectsConfiguration(`jupyter.${enabledSettingName}`)) {
                    this.enabled = this.workspace.getConfiguration('jupyter').get<boolean>(enabledSettingName, true);
                    if (this.enabled) {
                        window.visibleTextEditors.forEach((editor) => this.provideDiagnosticsForEditor(editor));
                    } else {
                        this.diagnosticCollection.clear();
                    }
                    this._onDidChangeFileDecorations.fire(undefined);
                }
            },
            this,
            this.disposables
        );

        window.onDidChangeActiveTextEditor(this.provideDiagnosticsForEditor, this, this.disposables);
        workspace.onDidCloseTextDocument((e) => this.diagnosticCollection.delete(e.uri), this, this.disposables);
        window.visibleTextEditors.forEach((editor) => this.provideDiagnosticsForEditor(editor));
        this.disposables.push(
            commands.registerCommand(
                'jupyter.ignoreReservedFileNamesDiagnostic',
                async (uri: Uri) => {
                    await this.reservedNameProvider.addToIgnoreList(uri);
                    this._onDidChangeFileDecorations.fire(uri);
                    this.diagnosticCollection.forEach((item) => {
                        if (this.fileSystem.arePathsSame(item, uri)) {
                            this.diagnosticCollection.delete(item);
                        }
                    });
                },
                this
            )
        );
        this.disposables.push(
            commands.registerCommand(
                'jupyter.disableReservedFileNamesDiagnostic',
                async () => this.disableDiagnostics(),
                this
            )
        );
    }

    public async provideCodeActions(
        document: TextDocument,
        _range: Range,
        context: CodeActionContext
    ): Promise<CodeAction[]> {
        if (!this.enabled) {
            return [];
        }
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
            command: 'jupyter.disableReservedFileNamesDiagnostic',
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
        codeActionIgnore.isPreferred = true;

        const codeActions = [codeActionDisable, codeActionIgnore];
        codeActions.forEach((action) => (action.diagnostics = ourDiagnostic));
        return codeActions;
    }

    public async provideFileDecoration(uri: Uri, _token: CancellationToken): Promise<FileDecoration | undefined> {
        if (!this.enabled || !uri.fsPath.toLowerCase().endsWith('.py')) {
            return;
        }
        const ourDiagnostic = this.diagnosticCollection.get(uri);
        if (ourDiagnostic && ourDiagnostic.length > 0) {
            return new FileDecoration('!', ourDiagnostic[0].message, new ThemeColor('editorWarning.foreground'));
        }

        if (await this.reservedNameProvider.isReserved(uri)) {
            const diagnostic = new Diagnostic(
                new Range(0, 0, 0, 0),
                DataScience.pythonFileOverridesPythonPackage(),
                DiagnosticSeverity.Warning
            );
            diagnostic.code = {
                target: Uri.parse(JupyterKernelStartFailureOverrideReservedName),
                value: Common.learnMore()
            };
            diagnostic.source = Common.jupyter();
            this.diagnosticCollection.set(uri, [diagnostic]);
            return new FileDecoration('!', diagnostic.message, new ThemeColor('editorWarning.foreground'));
        }
    }

    private async disableDiagnostics() {
        this.enabled = false;
        const jupyterConfig = this.workspace.getConfiguration('jupyter');
        await jupyterConfig.update(enabledSettingName, false, ConfigurationTarget.Global);
        this.diagnosticCollection.clear();
        this._onDidChangeFileDecorations.fire(undefined);
    }

    @swallowExceptions()
    private async provideDiagnosticsForEditor(editor?: TextEditor) {
        if (!this.enabled || !editor || editor.document.languageId !== PYTHON_LANGUAGE) {
            return;
        }
        if (await this.reservedNameProvider.isReserved(editor.document.uri)) {
            const lastLine = editor.document.lineCount;
            const diagnostic = new Diagnostic(
                new Range(0, 0, lastLine, editor.document.lineAt(lastLine - 1).range.end.character),
                DataScience.pythonFileOverridesPythonPackage(),
                DiagnosticSeverity.Warning
            );
            diagnostic.code = {
                target: Uri.parse(JupyterKernelStartFailureOverrideReservedName),
                value: Common.learnMore()
            };
            diagnostic.source = Common.jupyter();
            this.diagnosticCollection.delete(editor.document.uri);
            this.diagnosticCollection.set(editor.document.uri, [diagnostic]);
            this._onDidChangeFileDecorations.fire(editor.document.uri);
        }
    }
}
