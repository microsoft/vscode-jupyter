// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { inject, injectable } from 'inversify';
import { ICellRange, IConfigurationService } from '../../platform/common/types';
import { IDisposable } from '../../platform/common/types';
import { generateCellRangesFromDocument } from './cellFactory';
import { ConfigurationChangeEvent } from 'vscode';
import { ContextKey } from '../../platform/common/contextKey';
import {
    EditorContexts,
    InteractiveInputScheme,
    NotebookCellScheme,
    PYTHON_LANGUAGE
} from '../../platform/common/constants';
import { noop } from '../../platform/common/utils/misc';
import { logger } from '../../platform/logging';
import { ICellRangeCache } from './types';

@injectable()
export class CellRangeCache implements ICellRangeCache {
    private cachedOwnsSetting: boolean;
    private cache = new Map<vscode.Uri, { version: number; ranges: ICellRange[] }>();
    private disposables: IDisposable[] = [];

    constructor(@inject(IConfigurationService) private readonly configService: IConfigurationService) {
        this.cachedOwnsSetting = this.configService.getSettings(undefined).sendSelectionToInteractiveWindow;
        vscode.workspace.onDidChangeConfiguration(this.onSettingChanged, this, this.disposables);
        vscode.window.onDidChangeActiveTextEditor(this.onChangedActiveTextEditor, this, this.disposables);
        this.onChangedActiveTextEditor();
        vscode.workspace.onDidCloseTextDocument(this.onClosedDocument, this, this.disposables);
    }

    public getCellRanges(document: vscode.TextDocument): ICellRange[] {
        const cached = this.cache.get(document.uri);
        if (cached && cached.version === document.version) {
            return cached.ranges;
        }

        const settings = this.configService.getSettings(document.uri);
        const ranges = generateCellRangesFromDocument(document, settings);
        this.cache.set(document.uri, { version: document.version, ranges });

        this.updateContextKeys(document);

        return ranges;
    }

    public clear(): void {
        this.cache.clear();
    }

    private onChangedActiveTextEditor() {
        const activeEditor = vscode.window.activeTextEditor;

        if (
            !activeEditor ||
            activeEditor.document.languageId != PYTHON_LANGUAGE ||
            [NotebookCellScheme, InteractiveInputScheme].includes(activeEditor.document.uri.scheme)
        ) {
            // set the context to false so our command doesn't run for other files
            const hasCellsContext = new ContextKey(EditorContexts.HasCodeCells);
            hasCellsContext.set(false).catch((ex) => logger.warn('Failed to set jupyter.HasCodeCells context', ex));
            this.updateContextKeys(false);
        } else {
            this.updateContextKeys(activeEditor.document);
        }
    }

    private onSettingChanged(e: ConfigurationChangeEvent) {
        this.cache.clear();

        if (e.affectsConfiguration('jupyter.interactiveWindow.textEditor.executeSelection')) {
            const settings = this.configService.getSettings(undefined);
            this.cachedOwnsSetting = settings.sendSelectionToInteractiveWindow;
            this.updateContextKeys();
        }
    }

    private updateContextKeys(documentOrOverride?: vscode.TextDocument | boolean) {
        let hasCodeCells = false;
        if (typeof documentOrOverride == 'boolean') {
            hasCodeCells = documentOrOverride;
        } else {
            const document = documentOrOverride ?? vscode.window.activeTextEditor?.document;
            hasCodeCells = document ? this.getCellRanges(document).length > 0 : false;
        }

        new ContextKey(EditorContexts.OwnsSelection).set(this.cachedOwnsSetting || hasCodeCells).catch(noop);
        new ContextKey(EditorContexts.HasCodeCells).set(hasCodeCells).catch(noop);
    }

    private onClosedDocument(doc: vscode.TextDocument) {
        this.cache.delete(doc.uri);

        // Don't delete the document execution count, we need to keep track
        // of it past the closing of a doc if the notebook or interactive window is still open.
    }

    public dispose() {
        this.disposables.forEach((d) => d.dispose());
    }
}
