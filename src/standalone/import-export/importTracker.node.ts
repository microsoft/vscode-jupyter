// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import type * as nbformat from '@jupyterlab/nbformat';
import { inject, injectable } from 'inversify';
import * as path from '../../platform/vscode-path/path';
import { NotebookCellExecutionStateChangeEvent, NotebookCellKind, NotebookDocument, TextDocument } from 'vscode';
import { captureTelemetry, sendTelemetryEvent } from '../../telemetry';
import { IExtensionSingleActivationService } from '../../platform/activation/types';
import { IDocumentManager, IVSCodeNotebook } from '../../platform/common/application/types';
import { isCI, isTestExecution, PYTHON_LANGUAGE } from '../../platform/common/constants';
import '../../platform/common/extensions';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { IDisposable, IDisposableRegistry } from '../../platform/common/types';
import { noop } from '../../platform/common/utils/misc';
import { EventName } from '../../platform/telemetry/constants';
import { getTelemetrySafeHashedString } from '../../platform/telemetry/helpers';
import { getAssociatedJupyterNotebook, isJupyterNotebook, splitMultilineString } from '../../platform/common/utils';

/*
Python has a fairly rich import statement. Originally the matching regexp was kept simple for
performance worries, but it led to false-positives due to matching things like docstrings with
phrases along the lines of "from the thing" or "import the thing". To minimize false-positives the
regexp does its best to validate the structure of the import line _within reason_. This leads to
us supporting the following (where `pkg` represents what we are actually capturing for telemetry):

- `from pkg import _`
- `from pkg import _, _`
- `from pkg import _ as _`
- `import pkg`
- `import pkg, pkg`
- `import pkg as _`

Things we are ignoring the following for simplicity/performance:

- `from pkg import (...)` (this includes single-line and multi-line imports with parentheses)
- `import pkg  # ... and anything else with a trailing comment.`
- Non-standard whitespace separators within the import statement (i.e. more than a single space, tabs)

*/
const ImportRegEx =
    /^\s*(from (?<fromImport>\w+)(?:\.\w+)* import \w+(?:, \w+)*(?: as \w+)?|import (?<importImport>\w+(?:, \w+)*)(?: as \w+)?)$/;
const MAX_DOCUMENT_LINES = 1000;

// Capture isTestExecution on module load so that a test can turn it off and still
// have this value set.
const testExecution = isTestExecution();

export const IImportTracker = Symbol('IImportTracker');
export interface IImportTracker {}

/**
 * Sends hashed names of imported packages to telemetry. Hashes are updated on opening, closing, and saving of documents.
 */
@injectable()
export class ImportTracker implements IExtensionSingleActivationService, IDisposable {
    private pendingChecks = new Map<string, NodeJS.Timer | number>();
    private disposables: IDisposable[] = [];
    private sentMatches: Set<string> = new Set<string>();
    constructor(
        @inject(IDocumentManager) private documentManager: IDocumentManager,
        @inject(IVSCodeNotebook) private vscNotebook: IVSCodeNotebook,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry
    ) {
        disposables.push(this);
        this.documentManager.onDidOpenTextDocument((t) => this.onOpenedOrSavedDocument(t), this.disposables);
        this.documentManager.onDidSaveTextDocument((t) => this.onOpenedOrSavedDocument(t), this.disposables);
        this.vscNotebook.onDidOpenNotebookDocument((t) => this.onOpenedOrClosedNotebookDocument(t), this.disposables);
        this.vscNotebook.onDidCloseNotebookDocument((t) => this.onOpenedOrClosedNotebookDocument(t), this.disposables);
        this.vscNotebook.onDidSaveNotebookDocument((t) => this.onOpenedOrClosedNotebookDocument(t), this.disposables);
        this.vscNotebook.onDidChangeNotebookCellExecutionState((e) => this.checkNotebookCell(e), this, disposables);
    }

    public dispose() {
        disposeAllDisposables(this.disposables);
        this.pendingChecks.clear();
    }

    public async activate(): Promise<void> {
        // Act like all of our open documents just opened; our timeout will make sure this is delayed.
        this.documentManager.textDocuments.forEach((d) => this.onOpenedOrSavedDocument(d));
        this.vscNotebook.notebookDocuments.forEach((e) => this.checkNotebookDocument(e));
    }

    private getDocumentLines(document: TextDocument): (string | undefined)[] {
        const array = Array<string>(Math.min(document.lineCount, MAX_DOCUMENT_LINES)).fill('');
        return array
            .map((_a: string, i: number) => {
                const line = document.lineAt(i);
                if (line && !line.isEmptyOrWhitespace) {
                    return line.text;
                }
                return undefined;
            })
            .filter((f: string | undefined) => f);
    }

    private getNotebookDocumentLines(e: NotebookDocument): (string | undefined)[] {
        const result: (string | undefined)[] = [];
        try {
            e.getCells()
                .filter((cell) => cell.kind === NotebookCellKind.Code)
                .filter((cell) => cell.document.languageId === PYTHON_LANGUAGE)
                .forEach((c) => {
                    const cellArray = this.getCellLinesFromSource(c.document.getText());
                    if (result.length < MAX_DOCUMENT_LINES) {
                        result.push(...cellArray);
                    }
                });
        } catch (ex) {
            // Can fail on CI, if the notebook has been closed or the like
            if (!isCI) {
                throw ex;
            }
        }
        return result;
    }

    private getCellLinesFromSource(source: nbformat.MultilineString): (string | undefined)[] {
        // Split into multiple lines removing line feeds on the end.
        return splitMultilineString(source).map((s) => s.replace(/\n/g, ''));
    }

    private onOpenedOrSavedDocument(document: TextDocument) {
        // Make sure this is a Python file.
        if (path.extname(document.fileName) === '.py') {
            this.scheduleDocument(document);
        }
        if (getAssociatedJupyterNotebook(document) && document.languageId === PYTHON_LANGUAGE) {
            this.scheduleDocument(document);
        }
    }
    private onOpenedOrClosedNotebookDocument(e: NotebookDocument) {
        if (!isJupyterNotebook(e)) {
            return;
        }
        this.scheduleCheck(e.uri.fsPath, this.checkNotebookDocument.bind(this, e));
    }

    private scheduleDocument(document: TextDocument) {
        this.scheduleCheck(document.fileName, this.checkDocument.bind(this, document));
    }

    private scheduleCheck(file: string, check: () => void) {
        // If already scheduled, cancel.
        const currentTimeout = this.pendingChecks.get(file);
        if (currentTimeout) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            clearTimeout(currentTimeout as any);
            this.pendingChecks.delete(file);
        }

        // Now schedule a new one.
        if (testExecution) {
            // During a test, check right away. It needs to be synchronous.
            check();
        } else {
            // Wait five seconds to make sure we don't already have this document pending.
            this.pendingChecks.set(file, setTimeout(check, 5000));
        }
    }

    @captureTelemetry(EventName.HASHED_PACKAGE_PERF)
    private checkNotebookDocument(e: NotebookDocument) {
        this.pendingChecks.delete(e.uri.fsPath);
        const lines = this.getNotebookDocumentLines(e);
        this.lookForImports(lines);
    }

    @captureTelemetry(EventName.HASHED_PACKAGE_PERF)
    private checkNotebookCell(e: NotebookCellExecutionStateChangeEvent) {
        if (!isJupyterNotebook(e.cell.notebook)) {
            return;
        }
        this.pendingChecks.delete(e.cell.document.uri.toString());
        const result: (string | undefined)[] = [];
        try {
            if (e.cell.kind === NotebookCellKind.Code && e.cell.document.languageId === PYTHON_LANGUAGE) {
                const cellArray = this.getCellLinesFromSource(e.cell.document.getText());
                if (result.length < MAX_DOCUMENT_LINES) {
                    result.push(...cellArray);
                }
            }
        } catch (ex) {
            // Can fail on CI, if the notebook has been closed or the like
            if (!isCI) {
                throw ex;
            }
        }

        this.lookForImports(result);
    }

    @captureTelemetry(EventName.HASHED_PACKAGE_PERF)
    private checkDocument(document: TextDocument) {
        this.pendingChecks.delete(document.fileName);
        const lines = this.getDocumentLines(document);
        this.lookForImports(lines);
    }

    private sendTelemetry(packageName: string) {
        // No need to send duplicate telemetry or waste CPU cycles on an unneeded hash.
        if (this.sentMatches.has(packageName)) {
            return;
        }
        this.sentMatches.add(packageName);
        // Hash the package name so that we will never accidentally see a
        // user's private package name.
        const hash = getTelemetrySafeHashedString(packageName);
        sendTelemetryEvent(EventName.HASHED_PACKAGE_NAME, undefined, { hashedNamev2: hash });
    }

    private lookForImports(lines: (string | undefined)[]) {
        try {
            for (const s of lines) {
                const match = s ? ImportRegEx.exec(s) : null;
                if (match !== null && match.groups !== undefined) {
                    if (match.groups.fromImport !== undefined) {
                        // `from pkg ...`
                        this.sendTelemetry(match.groups.fromImport);
                    } else if (match.groups.importImport !== undefined) {
                        // `import pkg1, pkg2, ...`
                        const packageNames = match.groups.importImport
                            .split(',')
                            .map((rawPackageName) => rawPackageName.trim());
                        // Can't pass in `this.sendTelemetry` directly as that rebinds `this`.
                        packageNames.forEach((p) => this.sendTelemetry(p));
                    }
                }
            }
        } catch {
            // Don't care about failures since this is just telemetry.
            noop();
        }
    }
}
