// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { QuickPickItem, QuickPickOptions, Uri } from 'vscode';
import { getLocString } from '../../../datascience-ui/react-common/locReactSide';
import { ICommandNameArgumentTypeMapping } from '../../common/application/commands';
import { IApplicationShell, ICommandManager } from '../../common/application/types';
import { PYTHON_LANGUAGE } from '../../common/constants';
import { IFileSystem } from '../../common/platform/types';

import { IDisposable } from '../../common/types';
import { DataScience } from '../../common/utils/localize';
import { NotebookEditor } from '../../datascience/notebook/notebookEditor';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { sendTelemetryEvent } from '../../telemetry';
import { Commands, Telemetry } from '../constants';
import { ExportManager } from '../export/exportManager';
import { ExportFormat, IExportManager } from '../export/types';
import { getNotebookMetadata } from '../notebook/helpers/helpers';
import { INotebookEditorProvider, INotebookModel } from '../types';

interface IExportQuickPickItem extends QuickPickItem {
    handler(): void;
}

@injectable()
export class ExportCommands implements IDisposable {
    private readonly disposables: IDisposable[] = [];
    constructor(
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IExportManager) private exportManager: ExportManager,
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(INotebookEditorProvider) private readonly notebookProvider: INotebookEditorProvider,
        @inject(IFileSystem) private readonly fs: IFileSystem
    ) {}
    public register() {
        this.registerCommand(Commands.ExportAsPythonScript, (model, interpreter?) =>
            this.export(model, ExportFormat.python, undefined, interpreter)
        );
        this.registerCommand(Commands.ExportToHTML, (model, defaultFileName?, interpreter?) =>
            this.export(model, ExportFormat.html, defaultFileName, interpreter)
        );
        this.registerCommand(Commands.ExportToPDF, (model, defaultFileName?, interpreter?) =>
            this.export(model, ExportFormat.pdf, defaultFileName, interpreter)
        );
        this.registerCommand(Commands.Export, (model, defaultFileName?, interpreter?) =>
            this.export(model, undefined, defaultFileName, interpreter)
        );
        this.registerCommand(Commands.NativeNotebookExport, (uri) => this.nativeNotebookExport(uri));
    }

    public dispose() {
        this.disposables.forEach((d) => d.dispose());
    }

    private registerCommand<
        E extends keyof ICommandNameArgumentTypeMapping,
        U extends ICommandNameArgumentTypeMapping[E]
        // tslint:disable-next-line: no-any
    >(command: E, callback: (...args: U) => any) {
        const disposable = this.commandManager.registerCommand(command, callback, this);
        this.disposables.push(disposable);
    }

    // The export command as called by the native notebook interface
    private async nativeNotebookExport(uri: Uri) {
        const editor = this.notebookProvider.editors.find((item) => this.fs.arePathsSame(item.file, uri));

        if (editor && editor.model) {
            const interpreter = editor.notebook?.getMatchingInterpreter();
            return this.export(editor.model, undefined, undefined, interpreter);
        } else {
            return this.export(undefined, undefined, undefined, undefined);
        }
    }

    private async export(
        model?: INotebookModel,
        exportMethod?: ExportFormat,
        defaultFileName?: string,
        interpreter?: PythonEnvironment
    ) {
        if (!model) {
            // if no model was passed then this was called from the command palette,
            // so we need to get the active editor
            const activeEditor = this.notebookProvider.activeEditor;
            if (!activeEditor || !activeEditor.model) {
                return;
            }
            model = activeEditor.model;

            // At this point also see if the active editor has a candidate interpreter to use
            if (!interpreter) {
                interpreter = activeEditor.notebook?.getMatchingInterpreter();
            }

            if (exportMethod) {
                sendTelemetryEvent(Telemetry.ExportNotebookAsCommand, undefined, { format: exportMethod });
            }
        }

        if (exportMethod) {
            await this.exportManager.export(exportMethod, model, defaultFileName, interpreter);
        } else {
            // if we don't have an export method we need to ask for one and display the
            // quickpick menu
            const pickedItem = await this.showExportQuickPickMenu(model, defaultFileName, interpreter).then(
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
        model: INotebookModel,
        defaultFileName?: string,
        interpreter?: PythonEnvironment
    ): IExportQuickPickItem[] {
        const items: IExportQuickPickItem[] = [];

        if (model.metadata && model.metadata.language_info && model.metadata.language_info.name === PYTHON_LANGUAGE) {
            items.push({
                label: DataScience.exportPythonQuickPickLabel(),
                picked: true,
                handler: () => {
                    sendTelemetryEvent(Telemetry.ClickedExportNotebookAsQuickPick, undefined, {
                        format: ExportFormat.python
                    });
                    this.commandManager.executeCommand(Commands.ExportAsPythonScript, model, interpreter);
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
                        this.commandManager.executeCommand(Commands.ExportToHTML, model, defaultFileName, interpreter);
                    }
                },
                {
                    label: DataScience.exportPDFQuickPickLabel(),
                    picked: false,
                    handler: () => {
                        sendTelemetryEvent(Telemetry.ClickedExportNotebookAsQuickPick, undefined, {
                            format: ExportFormat.pdf
                        });
                        this.commandManager.executeCommand(Commands.ExportToPDF, model, defaultFileName, interpreter);
                    }
                }
            ]
        );

        return items;
    }

    private async showExportQuickPickMenu(
        model: INotebookModel,
        defaultFileName?: string,
        interpreter?: PythonEnvironment
    ): Promise<IExportQuickPickItem | undefined> {
        const items = this.getExportQuickPickItems(model, defaultFileName, interpreter);

        const options: QuickPickOptions = {
            ignoreFocusOut: false,
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder: getLocString('DataScience.exportAsQuickPickPlaceholder', 'Export As...')
        };

        return this.applicationShell.showQuickPick(items, options);
    }
}
