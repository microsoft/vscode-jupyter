// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import * as vscode from 'vscode';

import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IPythonExtensionChecker } from '../../platform/api/types';
import { PYTHON_LANGUAGE } from '../../platform/common/constants';
import { IConfigurationService, IDisposable, IDisposableRegistry, IJupyterSettings } from '../../platform/common/types';
import { getAssociatedJupyterNotebook } from '../../platform/common/utils';
import { generateCellRangesFromDocument } from './cellFactory';
import { window } from 'vscode';

/**
 * Provides the lines that show up between cells in the editor.
 */
@injectable()
export class Decorator implements IExtensionSyncActivationService, IDisposable {
    private currentCellTop: vscode.TextEditorDecorationType | undefined;
    private currentCellBottom: vscode.TextEditorDecorationType | undefined;
    private currentCellTopUnfocused: vscode.TextEditorDecorationType | undefined;
    private currentCellBottomUnfocused: vscode.TextEditorDecorationType | undefined;
    private timer: NodeJS.Timer | undefined | number;

    constructor(
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IConfigurationService) private configuration: IConfigurationService,
        @inject(IPythonExtensionChecker) private extensionChecker: IPythonExtensionChecker
    ) {
        this.computeDecorations();
        disposables.push(this);
        disposables.push(this.configuration.getSettings(undefined).onDidChange(this.settingsChanged, this));
        disposables.push(vscode.window.onDidChangeActiveTextEditor(this.changedEditor, this));
        disposables.push(vscode.window.onDidChangeTextEditorSelection(this.changedSelection, this));
        disposables.push(vscode.workspace.onDidChangeTextDocument(this.changedDocument, this));
        this.settingsChanged();
    }

    public activate() {
        // We don't need to do anything here as we already did all of our work in the
        // constructor.
    }

    public dispose() {
        if (this.timer) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            clearTimeout(this.timer as any);
        }
    }

    private settingsChanged() {
        if (vscode.window.activeTextEditor) {
            this.triggerUpdate(vscode.window.activeTextEditor);
        }
    }

    private changedEditor() {
        this.triggerUpdate(undefined);
    }

    private changedDocument(e: vscode.TextDocumentChangeEvent) {
        if (vscode.window.activeTextEditor && e.document === vscode.window.activeTextEditor.document) {
            this.triggerUpdate(window.activeTextEditor);
        }
    }

    private changedSelection(e: vscode.TextEditorSelectionChangeEvent) {
        if (e.textEditor && e.textEditor.selection.anchor) {
            this.triggerUpdate(e.textEditor);
        }
    }

    private triggerUpdate(editor: vscode.TextEditor | undefined) {
        if (this.timer) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            clearTimeout(this.timer as any);
        }
        this.timer = setTimeout(() => this.update(editor), 100);
    }

    private computeDecorations() {
        this.currentCellTopUnfocused = window.createTextEditorDecorationType({
            borderColor: new vscode.ThemeColor('interactive.inactiveCodeBorder'),
            borderWidth: '2px 0px 0px 0px',
            borderStyle: 'solid',
            isWholeLine: true
        });
        this.currentCellBottomUnfocused = window.createTextEditorDecorationType({
            borderColor: new vscode.ThemeColor('interactive.inactiveCodeBorder'),
            borderWidth: '0px 0px 1px 0px',
            borderStyle: 'solid',
            isWholeLine: true
        });
        this.currentCellTop = window.createTextEditorDecorationType({
            borderColor: new vscode.ThemeColor('interactive.activeCodeBorder'),
            borderWidth: '2px 0px 0px 0px',
            borderStyle: 'solid',
            isWholeLine: true
        });
        this.currentCellBottom = window.createTextEditorDecorationType({
            borderColor: new vscode.ThemeColor('interactive.activeCodeBorder'),
            borderWidth: '0px 0px 1px 0px',
            borderStyle: 'solid',
            isWholeLine: true
        });
    }

    private cellDecorationEnabled(settings: IJupyterSettings) {
        // check old true/false value for this setting
        if ((settings.decorateCells as unknown as boolean) === false) {
            return false;
        }

        return settings.decorateCells === 'currentCell' || settings.decorateCells === 'allCells';
    }

    /**
     *
     * @param editor The editor to update cell decorations in.
     * If left undefined, this function will update all visible text editors.
     */
    private update(editor: vscode.TextEditor | undefined) {
        // Don't look through all visible editors unless we have to i.e. the active editor has changed
        const editorsToCheck = editor === undefined ? window.visibleTextEditors : [editor];
        for (const editor of editorsToCheck) {
            if (
                editor &&
                editor.document &&
                editor.document.languageId === PYTHON_LANGUAGE &&
                !getAssociatedJupyterNotebook(editor.document) &&
                this.currentCellTop &&
                this.currentCellBottom &&
                this.currentCellTopUnfocused &&
                this.currentCellBottomUnfocused &&
                this.extensionChecker.isPythonExtensionInstalled
            ) {
                const settings = this.configuration.getSettings(editor.document.uri);
                if (this.cellDecorationEnabled(settings)) {
                    // Find all of the cells
                    const cells = generateCellRangesFromDocument(editor.document, settings);
                    // Find the range for our active cell.
                    const currentRange = cells.map((c) => c.range).filter((r) => r.contains(editor.selection.anchor));
                    const rangeTop =
                        currentRange.length > 0 ? [new vscode.Range(currentRange[0].start, currentRange[0].start)] : [];
                    // no need to decorate the bottom if we're decorating all cells
                    const rangeBottom =
                        settings.decorateCells !== 'allCells' && currentRange.length > 0
                            ? [new vscode.Range(currentRange[0].end, currentRange[0].end)]
                            : [];
                    const nonCurrentCells: vscode.Range[] = [];
                    if (settings.decorateCells === 'allCells')
                        cells.forEach((cell) => {
                            const cellTop = cell.range.start;
                            if (cellTop !== currentRange[0].start) {
                                nonCurrentCells.push(new vscode.Range(cellTop, cellTop));
                            }
                        });
                    if (window.activeTextEditor === editor) {
                        editor.setDecorations(this.currentCellTop, rangeTop);
                        editor.setDecorations(this.currentCellBottom, rangeBottom);
                        editor.setDecorations(this.currentCellTopUnfocused, nonCurrentCells);
                        editor.setDecorations(this.currentCellBottomUnfocused, []);
                    } else {
                        editor.setDecorations(this.currentCellTop, []);
                        editor.setDecorations(this.currentCellBottom, []);
                        editor.setDecorations(this.currentCellTopUnfocused, [...nonCurrentCells, ...rangeTop]);
                        editor.setDecorations(this.currentCellBottomUnfocused, rangeBottom);
                    }
                } else {
                    editor.setDecorations(this.currentCellTop, []);
                    editor.setDecorations(this.currentCellBottom, []);
                    editor.setDecorations(this.currentCellTopUnfocused, []);
                    editor.setDecorations(this.currentCellBottomUnfocused, []);
                }
            }
        }
    }
}
