// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { NotebookDocument, QuickPickItem, QuickPickOptions, Uri } from 'vscode';
import { getLocString } from '../../../datascience-ui/react-common/locReactSide';
import { ICommandNameArgumentTypeMapping } from '../../common/application/commands';
import { IApplicationShell, ICommandManager, IVSCodeNotebook } from '../../common/application/types';
import { traceInfo } from '../../common/logger';
import { IFileSystem } from '../../common/platform/types';
import { IDisposable } from '../../common/types';
import { DataScience } from '../../common/utils/localize';
import { isUri } from '../../common/utils/misc';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { sendTelemetryEvent } from '../../telemetry';
import { Commands, Telemetry } from '../constants';
import { FileConverter } from '../export/fileConverter';
import { ExportFormat, IFileConverter } from '../export/types';
import { getActiveInteractiveWindow } from '../interactive-window/helpers';
import { getNotebookMetadata, isPythonNotebook } from '../notebook/helpers/helpers';
import { INotebookControllerManager } from '../notebook/types';
import { IInteractiveWindowProvider } from '../types';

interface IExportQuickPickItem extends QuickPickItem {
    handler(): void;
}

@injectable()
export class ExportCommands implements IDisposable {
    private readonly disposables: IDisposable[] = [];
    constructor(
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IFileConverter) private fileConverter: FileConverter,
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IVSCodeNotebook) private readonly notebooks: IVSCodeNotebook,
        @inject(IInteractiveWindowProvider) private readonly interactiveProvider: IInteractiveWindowProvider,
        @inject(INotebookControllerManager) private readonly controllers: INotebookControllerManager
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
        const notebookUri = isUri(context) ? context : context?.notebookEditor.notebookUri;
        const document = notebookUri
            ? this.notebooks.notebookDocuments.find((item) => this.fs.arePathsSame(item.uri, notebookUri))
            : this.notebooks.activeNotebookEditor?.document;

        if (document) {
            const interpreter =
                this.controllers.getSelectedNotebookController(document)?.connection.interpreter ||
                this.controllers.getPreferredNotebookController(document)?.connection.interpreter;
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
                this.notebooks.activeNotebookEditor?.document ||
                getActiveInteractiveWindow(this.interactiveProvider)?.notebookDocument;
            if (!sourceDocument) {
                traceInfo('Export called without a valid exportable document active');
                return;
            }

            // At this point also see if the active editor has a candidate interpreter to use
            interpreter =
                interpreter ||
                this.controllers.getSelectedNotebookController(sourceDocument)?.connection.interpreter ||
                this.controllers.getPreferredNotebookController(sourceDocument)?.connection.interpreter;
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
                    void this.commandManager.executeCommand(Commands.ExportAsPythonScript, sourceDocument, interpreter);
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
                        void this.commandManager.executeCommand(
                            Commands.ExportToHTML,
                            sourceDocument,
                            defaultFileName,
                            interpreter
                        );
                    }
                },
                {
                    label: DataScience.exportPDFQuickPickLabel(),
                    picked: false,
                    handler: () => {
                        sendTelemetryEvent(Telemetry.ClickedExportNotebookAsQuickPick, undefined, {
                            format: ExportFormat.pdf
                        });
                        void this.commandManager.executeCommand(
                            Commands.ExportToPDF,
                            sourceDocument,
                            defaultFileName,
                            interpreter
                        );
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
            placeHolder: getLocString('DataScience.exportAsQuickPickPlaceholder', 'Export As...')
        };

        return this.applicationShell.showQuickPick(items, options);
    }
}
