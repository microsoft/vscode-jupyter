// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { NotebookDocument, QuickPickItem, QuickPickOptions, Uri } from 'vscode';
import * as localize from '../../platform/common/utils/localize';
import { ICommandNameArgumentTypeMapping } from '../../commands';
import { IApplicationShell, ICommandManager, IVSCodeNotebook } from '../../platform/common/application/types';
import { traceInfo } from '../../platform/logging';
import { IDisposable } from '../../platform/common/types';
import { DataScience } from '../../platform/common/utils/localize';
import { isUri, noop } from '../../platform/common/utils/misc';
import { PythonEnvironment } from '../../platform/pythonEnvironments/info';
import { sendTelemetryEvent } from '../../telemetry';
import { Commands, Telemetry } from '../../platform/common/constants';
import { IFileConverter, ExportFormat } from '../../notebooks/export/types';
import { IInteractiveWindowProvider } from '../../interactive-window/types';
import { IFileSystem } from '../../platform/common/platform/types';
import { getNotebookMetadata } from '../../platform/common/utils';
import { isPythonNotebook } from '../../kernels/helpers';
import { IControllerSelection, IControllerPreferredService } from '../../notebooks/controllers/types';

interface IExportQuickPickItem extends QuickPickItem {
    handler(): void;
}

/**
 * Registers the notebook specific import/export commands
 */
export class ExportCommands implements IDisposable {
    private readonly disposables: IDisposable[] = [];
    constructor(
        private readonly commandManager: ICommandManager,
        private fileConverter: IFileConverter,
        private readonly applicationShell: IApplicationShell,
        private readonly fs: IFileSystem,
        private readonly notebooks: IVSCodeNotebook,
        private readonly interactiveProvider: IInteractiveWindowProvider | undefined,
        private readonly controllerSelection: IControllerSelection,
        private readonly controllerPreferred: IControllerPreferredService
    ) {}
    public register() {
        this.registerCommand(Commands.ExportAsPythonScript, (sourceDocument, interpreter?) =>
            this.export(sourceDocument, ExportFormat.python, undefined, interpreter)
        );
        this.registerCommand(Commands.ExportToHTML, (sourceDocument, defaultFileName?, interpreter?) =>
            this.export(sourceDocument, ExportFormat.html, defaultFileName, interpreter)
        );
        this.registerCommand(Commands.ExportToPDF, (sourceDocument, defaultFileName?, interpreter?) =>
            this.export(sourceDocument, ExportFormat.pdf, defaultFileName, interpreter)
        );
        this.registerCommand(Commands.Export, (sourceDocument, defaultFileName?, interpreter?) =>
            this.export(sourceDocument, undefined, defaultFileName, interpreter)
        );
        this.registerCommand(Commands.NativeNotebookExport, (uri) => this.nativeNotebookExport(uri));
    }

    public dispose() {
        this.disposables.forEach((d) => d.dispose());
    }

    private registerCommand<
        E extends keyof ICommandNameArgumentTypeMapping,
        U extends ICommandNameArgumentTypeMapping[E]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    >(command: E, callback: (...args: U) => any) {
        const disposable = this.commandManager.registerCommand(command, callback, this);
        this.disposables.push(disposable);
    }

    private async nativeNotebookExport(context?: Uri | { notebookEditor: { notebookUri: Uri } }) {
        const notebookUri = isUri(context) ? context : context?.notebookEditor?.notebookUri;
        const document = notebookUri
            ? this.notebooks.notebookDocuments.find((item) => this.fs.arePathsSame(item.uri, notebookUri))
            : this.notebooks.activeNotebookEditor?.notebook;

        if (document) {
            const interpreter =
                this.controllerSelection.getSelected(document)?.connection.interpreter ||
                this.controllerPreferred.getPreferred(document)?.connection.interpreter;
            return this.export(document, undefined, undefined, interpreter);
        } else {
            return this.export(undefined, undefined, undefined, undefined);
        }
    }

    private async export(
        sourceDocument?: NotebookDocument,
        exportMethod?: ExportFormat,
        defaultFileName?: string,
        interpreter?: PythonEnvironment
    ) {
        if (!sourceDocument) {
            // if no source document was passed then this was called from the command palette,
            // so we need to get the active editor
            sourceDocument =
                this.notebooks.activeNotebookEditor?.notebook ||
                this.interactiveProvider?.getActiveOrAssociatedInteractiveWindow()?.notebookDocument;
            if (!sourceDocument) {
                traceInfo('Export called without a valid exportable document active');
                return;
            }

            // At this point also see if the active editor has a candidate interpreter to use
            interpreter =
                interpreter ||
                this.controllerSelection.getSelected(sourceDocument)?.connection.interpreter ||
                this.controllerPreferred.getPreferred(sourceDocument)?.connection.interpreter;
            if (exportMethod) {
                sendTelemetryEvent(Telemetry.ExportNotebookAsCommand, undefined, { format: exportMethod });
            }
        }

        if (exportMethod) {
            await this.fileConverter.export(exportMethod, sourceDocument, defaultFileName, interpreter);
        } else {
            // if we don't have an export method we need to ask for one and display the
            // quickpick menu
            const pickedItem = await this.showExportQuickPickMenu(sourceDocument, defaultFileName, interpreter).then(
                (item) => item
            );
            if (pickedItem !== undefined) {
                pickedItem.handler();
            } else {
                sendTelemetryEvent(Telemetry.ClickedExportNotebookAsQuickPick);
            }
        }
    }
    private getExportQuickPickItems(
        sourceDocument: NotebookDocument,
        defaultFileName?: string,
        interpreter?: PythonEnvironment
    ): IExportQuickPickItem[] {
        const items: IExportQuickPickItem[] = [];

        if (interpreter || (sourceDocument.metadata && isPythonNotebook(getNotebookMetadata(sourceDocument)))) {
            items.push({
                label: DataScience.exportPythonQuickPickLabel(),
                picked: true,
                handler: () => {
                    sendTelemetryEvent(Telemetry.ClickedExportNotebookAsQuickPick, undefined, {
                        format: ExportFormat.python
                    });
                    this.commandManager
                        .executeCommand(Commands.ExportAsPythonScript, sourceDocument, interpreter)
                        .then(noop, noop);
                }
            });
        }

        items.push(
            ...[
                {
                    label: DataScience.exportHTMLQuickPickLabel(),
                    picked: false,
                    handler: () => {
                        sendTelemetryEvent(Telemetry.ClickedExportNotebookAsQuickPick, undefined, {
                            format: ExportFormat.html
                        });
                        this.commandManager
                            .executeCommand(Commands.ExportToHTML, sourceDocument, defaultFileName, interpreter)
                            .then(noop, noop);
                    }
                },
                {
                    label: DataScience.exportPDFQuickPickLabel(),
                    picked: false,
                    handler: () => {
                        sendTelemetryEvent(Telemetry.ClickedExportNotebookAsQuickPick, undefined, {
                            format: ExportFormat.pdf
                        });
                        this.commandManager
                            .executeCommand(Commands.ExportToPDF, sourceDocument, defaultFileName, interpreter)
                            .then(noop, noop);
                    }
                }
            ]
        );

        return items;
    }

    private async showExportQuickPickMenu(
        sourceDocument: NotebookDocument,
        defaultFileName?: string,
        interpreter?: PythonEnvironment
    ): Promise<IExportQuickPickItem | undefined> {
        const items = this.getExportQuickPickItems(sourceDocument, defaultFileName, interpreter);

        const options: QuickPickOptions = {
            ignoreFocusOut: false,
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder: localize.DataScience.exportAsQuickPickPlaceholder()
        };

        return this.applicationShell.showQuickPick(items, options);
    }
}
