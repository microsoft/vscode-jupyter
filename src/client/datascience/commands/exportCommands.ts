// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { nbformat } from '@jupyterlab/coreutils';
import { inject, injectable } from 'inversify';
import { QuickPickItem, QuickPickOptions, Uri } from 'vscode';
import { getLocString } from '../../../datascience-ui/react-common/locReactSide';
import { ICommandNameArgumentTypeMapping } from '../../common/application/commands';
import { IApplicationShell, ICommandManager } from '../../common/application/types';
import { IFileSystem } from '../../common/platform/types';
import { IDisposable } from '../../common/types';
import { DataScience } from '../../common/utils/localize';
import { isUri } from '../../common/utils/misc';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { sendTelemetryEvent } from '../../telemetry';
import { Commands, Telemetry } from '../constants';
import { ExportManager } from '../export/exportManager';
import { ExportFormat, IExportManager } from '../export/types';
import { isPythonNotebook } from '../notebook/helpers/helpers';
import { INotebookEditorProvider } from '../types';

export interface IExportCommandsTestInterface {
    getExportQuickPickItems: () => IExportQuickPickItem[];
}
interface IExportQuickPickItem extends QuickPickItem {
    handler(): Promise<void>;
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
        this.registerCommand(Commands.ExportAsPythonScript, (contents, file, interpreter?) =>
            this.export(contents, file, ExportFormat.python, undefined, interpreter)
        );
        this.registerCommand(Commands.ExportToHTML, (contents, file, defaultFileName?, interpreter?) =>
            this.export(contents, file, ExportFormat.html, defaultFileName, interpreter)
        );
        this.registerCommand(Commands.ExportToPDF, (contents, file, defaultFileName?, interpreter?) =>
            this.export(contents, file, ExportFormat.pdf, defaultFileName, interpreter)
        );
        this.registerCommand(Commands.Export, (contents, file, defaultFileName?, interpreter?) =>
            this.export(contents, file, undefined, defaultFileName, interpreter)
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
        const editor = notebookUri
            ? this.notebookProvider.editors.find((item) => this.fs.arePathsSame(item.file, notebookUri))
            : this.notebookProvider.activeEditor;

        if (editor) {
            const contents = editor.getContent();
            const interpreter = editor.notebook?.getMatchingInterpreter();
            return this.export(contents, editor.file, undefined, undefined, interpreter);
        } else {
            return this.export(undefined, undefined, undefined, undefined);
        }
    }

    private async export(
        contents?: string,
        source?: Uri,
        exportMethod?: ExportFormat,
        defaultFileName?: string,
        interpreter?: PythonEnvironment
    ) {
        if (!contents || !source) {
            // if no contents was passed then this was called from the command palette,
            // so we need to get the active editor
            const activeEditor = this.notebookProvider.activeEditor;
            if (!activeEditor) {
                return;
            }
            contents = contents ? contents : activeEditor.getContent();
            source = source ? source : activeEditor.file;

            // At this point also see if the active editor has a candidate interpreter to use
            if (!interpreter) {
                interpreter = activeEditor.notebook?.getMatchingInterpreter();
            }

            if (exportMethod) {
                sendTelemetryEvent(Telemetry.ExportNotebookAsCommand, undefined, { format: exportMethod });
            }
        }

        if (exportMethod) {
            await this.exportManager.export(exportMethod, contents, source, defaultFileName, interpreter);
        } else {
            // if we don't have an export method we need to ask for one and display the
            // quickpick menu
            const pickedItem = await this.showExportQuickPickMenu(contents, source, defaultFileName, interpreter).then(
                (item) => item
            );
            if (pickedItem !== undefined) {
                await pickedItem.handler();
            } else {
                sendTelemetryEvent(Telemetry.ClickedExportNotebookAsQuickPick);
            }
        }
    }

    private getExportQuickPickItems(
        contents: string,
        source: Uri,
        defaultFileName?: string,
        interpreter?: PythonEnvironment
    ): IExportQuickPickItem[] {
        const items: IExportQuickPickItem[] = [];
        const notebook = JSON.parse(contents) as nbformat.INotebookContent;

        if (interpreter || (notebook.metadata && isPythonNotebook(notebook.metadata))) {
            items.push({
                label: DataScience.exportPythonQuickPickLabel(),
                picked: true,
                handler: async () => {
                    sendTelemetryEvent(Telemetry.ClickedExportNotebookAsQuickPick, undefined, {
                        format: ExportFormat.python
                    });
                    await this.commandManager.executeCommand(
                        Commands.ExportAsPythonScript,
                        contents,
                        source,
                        interpreter
                    );
                }
            });
        }

        items.push(
            ...[
                {
                    label: DataScience.exportHTMLQuickPickLabel(),
                    picked: false,
                    handler: async () => {
                        sendTelemetryEvent(Telemetry.ClickedExportNotebookAsQuickPick, undefined, {
                            format: ExportFormat.html
                        });
                        await this.commandManager.executeCommand(
                            Commands.ExportToHTML,
                            contents,
                            source,
                            defaultFileName,
                            interpreter
                        );
                    }
                },
                {
                    label: DataScience.exportPDFQuickPickLabel(),
                    picked: false,
                    handler: async () => {
                        sendTelemetryEvent(Telemetry.ClickedExportNotebookAsQuickPick, undefined, {
                            format: ExportFormat.pdf
                        });
                        await this.commandManager.executeCommand(
                            Commands.ExportToPDF,
                            contents,
                            source,
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
        contents: string,
        source: Uri,
        defaultFileName?: string,
        interpreter?: PythonEnvironment
    ): Promise<IExportQuickPickItem | undefined> {
        const items = this.getExportQuickPickItems(contents, source, defaultFileName, interpreter);

        const options: QuickPickOptions = {
            ignoreFocusOut: false,
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder: getLocString('DataScience.exportAsQuickPickPlaceholder', 'Export As...')
        };

        return this.applicationShell.showQuickPick(items, options);
    }
}
