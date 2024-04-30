// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Disposable, NotebookCell, NotebookCellKind, NotebookDocument, TextDocument, Uri, workspace } from 'vscode';
import { ResourceTypeTelemetryProperty, onDidChangeTelemetryEnablement, sendTelemetryEvent } from '../../telemetry';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { isCI, isTestExecution, JupyterNotebookView, PYTHON_LANGUAGE } from '../../platform/common/constants';
import { DisposableStore, dispose } from '../../platform/common/utils/lifecycle';
import { IDisposableRegistry, type IDisposable } from '../../platform/common/types';
import { noop } from '../../platform/common/utils/misc';
import { EventName } from '../../platform/telemetry/constants';
import { getTelemetrySafeHashedString } from '../../platform/telemetry/helpers';
import { isJupyterNotebook } from '../../platform/common/utils';
import { isTelemetryDisabled } from '../../telemetry';
import { ResourceMap } from '../../platform/common/utils/map';
import { Delayer } from '../../platform/common/utils/async';
import { NotebookCellExecutionState, notebookCellExecutions } from '../../platform/notebooks/cellExecutionStateService';

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

/**
 * Sends hashed names of imported packages to telemetry. Hashes are updated on opening, closing, and saving of documents.
 */
@injectable()
export class ImportTracker implements IExtensionSyncActivationService {
    private pendingChecks = new ResourceMap<IDisposable>();
    private disposables = new DisposableStore();
    private sentMatches = new Set<string>();
    private readonly processedNotebookCells = new WeakMap<NotebookCell, number>();
    private isTelemetryDisabled: boolean;
    constructor(@inject(IDisposableRegistry) disposables: IDisposableRegistry, delay = 1_000) {
        disposables.push(this.disposables);
        this.disposables.add(new Disposable(() => dispose(this.pendingChecks.values())));
        this.isTelemetryDisabled = isTelemetryDisabled();
        this.disposables.add(
            workspace.onDidOpenNotebookDocument((t) => this.onOpenedOrClosedNotebookDocument(t, 'onOpenCloseOrSave'))
        );
        this.disposables.add(
            workspace.onDidCloseNotebookDocument((t) => this.onOpenedOrClosedNotebookDocument(t, 'onOpenCloseOrSave'))
        );
        this.disposables.add(
            workspace.onDidSaveNotebookDocument((t) => this.onOpenedOrClosedNotebookDocument(t, 'onOpenCloseOrSave'))
        );
        const delayer = this.disposables.add(new Delayer<void>(delay));
        this.disposables.add(
            notebookCellExecutions.onDidChangeNotebookCellExecutionState((e) => {
                void delayer.trigger(() => {
                    if (e.state == NotebookCellExecutionState.Pending && !this.isTelemetryDisabled) {
                        this.checkNotebookCell(e.cell, 'onExecution').catch(noop);
                    }
                });
            }, this)
        );
        this.disposables.add(onDidChangeTelemetryEnablement((enabled) => (this.isTelemetryDisabled = enabled)));
    }

    public activate() {
        workspace.notebookDocuments.forEach((e) => this.checkNotebookDocument(e, 'onOpenCloseOrSave'));
    }

    private getDocumentLines(document: TextDocument): string[] {
        const lines: string[] = [];
        for (let lineIndex = 0; lineIndex < Math.min(MAX_DOCUMENT_LINES, document.lineCount); lineIndex++) {
            const line = document.lineAt(lineIndex);
            if (!line.isEmptyOrWhitespace) {
                lines.push(line.text.trim());
            }
        }
        return lines;
    }

    private onOpenedOrClosedNotebookDocument(e: NotebookDocument, when: 'onExecution' | 'onOpenCloseOrSave') {
        if (!isJupyterNotebook(e) || this.isTelemetryDisabled) {
            return;
        }
        this.scheduleCheck(e.uri, this.checkNotebookDocument.bind(this, e, when));
    }

    private scheduleCheck(file: Uri, check: () => void) {
        // If already scheduled, cancel.
        const currentTimeout = this.pendingChecks.get(file);
        if (currentTimeout) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            currentTimeout.dispose();
            this.pendingChecks.delete(file);
        }

        // Now schedule a new one.
        if (testExecution) {
            // During a test, check right away. It needs to be synchronous.
            check();
        } else {
            // Wait five seconds to make sure we don't already have this document pending.
            const timeout = setTimeout(check, 5000);
            this.pendingChecks.set(file, new Disposable(() => clearTimeout(timeout)));
        }
    }

    private async checkNotebookDocument(e: NotebookDocument, when: 'onExecution' | 'onOpenCloseOrSave') {
        if (!isJupyterNotebook(e) || this.isTelemetryDisabled) {
            return;
        }
        await Promise.all(e.getCells().map(async (cell) => this.checkNotebookCell(cell, when)));
    }

    private async checkNotebookCell(cell: NotebookCell, when: 'onExecution' | 'onOpenCloseOrSave') {
        if (
            !isJupyterNotebook(cell.notebook) ||
            cell.kind !== NotebookCellKind.Code ||
            cell.document.languageId !== PYTHON_LANGUAGE ||
            this.processedNotebookCells.get(cell) === cell.document.version
        ) {
            return;
        }
        try {
            this.processedNotebookCells.set(cell, cell.document.version);
            const resourceType = cell.notebook.notebookType === JupyterNotebookView ? 'notebook' : 'interactive';
            await this.sendTelemetryForImports(this.getDocumentLines(cell.document), resourceType, when);
        } catch (ex) {
            // Can fail on CI, if the notebook has been closed or the like
            if (!isCI) {
                throw ex;
            }
        }
    }

    private lookForImports(lines: string[]) {
        const packageNames: string[] = [];
        try {
            for (const s of lines) {
                // No need of regex if we don't have imports
                if (!s.includes('import') && !s.includes('from')) {
                    continue;
                }
                const match = s ? ImportRegEx.exec(s) : null;
                if (match !== null && match.groups !== undefined) {
                    if (match.groups.fromImport !== undefined) {
                        // `from pkg ...`
                        packageNames.push(match.groups.fromImport);
                    } else if (match.groups.importImport !== undefined) {
                        // `import pkg1, pkg2, ...`
                        packageNames.push(
                            ...match.groups.importImport.split(',').map((rawPackageName) => rawPackageName.trim())
                        );
                    }
                }
            }
        } catch (ex) {
            // Don't care about failures since this is just telemetry.
            noop();
        }
        return packageNames;
    }

    private async sendTelemetryForImports(
        lines: string[],
        resourceType: ResourceTypeTelemetryProperty['resourceType'],
        when: 'onExecution' | 'onOpenCloseOrSave'
    ) {
        await Promise.all(
            this.lookForImports(lines).map(async (packageName) => {
                const key = `${packageName}_${resourceType || ''}_${when}`;
                // No need to send duplicate telemetry or waste CPU cycles on an unneeded hash.
                if (this.sentMatches.has(key)) {
                    return;
                }
                this.sentMatches.add(key);
                // Hash the package name so that we will never accidentally see a
                // user's private package name.
                const hash = await getTelemetrySafeHashedString(packageName);
                sendTelemetryEvent(EventName.HASHED_PACKAGE_NAME, undefined, {
                    hashedNamev2: hash,
                    resourceType,
                    when
                });
            })
        );
    }
}
