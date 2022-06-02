// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { Position, TextEditor, Uri } from 'vscode';
import { sendTelemetryEvent } from '../../telemetry';
import { IDocumentManager, IApplicationShell } from '../common/application/types';
import { Telemetry, PYTHON_LANGUAGE } from '../common/constants';
import { IFileSystem } from '../common/platform/types';
import { IBrowserService } from '../common/types';
import * as localize from '../common/utils/localize';
import { ExportFormat } from './types';

@injectable()
export class ExportFileOpener {
    constructor(
        @inject(IDocumentManager) protected readonly documentManager: IDocumentManager,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(IBrowserService) private readonly browserService: IBrowserService
    ) {}

    public async openFile(format: ExportFormat, uri: Uri, openDirectly: boolean = false) {
        if (format === ExportFormat.python) {
            await this.openPythonFile(uri, openDirectly);
            sendTelemetryEvent(Telemetry.ExportNotebookAs, undefined, {
                format: format,
                successful: true,
                opened: true
            });
        } else {
            const opened = await this.askOpenFile(uri, openDirectly);
            sendTelemetryEvent(Telemetry.ExportNotebookAs, undefined, {
                format: format,
                successful: true,
                opened: opened
            });
        }
    }

    private async openPythonFile(uri: Uri, openDirectly: boolean): Promise<void> {
        let editor: TextEditor;

        if (openDirectly) {
            editor = await this.documentManager.showTextDocument(uri);
        } else {
            const contents = await this.fs.readFile(uri);
            await this.fs.delete(uri);
            const doc = await this.documentManager.openTextDocument({ language: PYTHON_LANGUAGE, content: contents });
            editor = await this.documentManager.showTextDocument(doc);
        }

        // Edit the document so that it is dirty (add a space at the end)
        await editor.edit((editBuilder) => {
            editBuilder.insert(new Position(editor.document.lineCount, 0), '\n');
        });
    }

    private async askOpenFile(uri: Uri, openDirectly: boolean): Promise<boolean> {
        const yes = localize.DataScience.openExportFileYes();
        const no = localize.DataScience.openExportFileNo();
        const items = [yes, no];

        const selected = await this.applicationShell
            .showInformationMessage(localize.DataScience.openExportedFileMessage(), ...items)
            .then((item) => item);

        if (selected === yes) {
            if (openDirectly) {
                void this.documentManager.showTextDocument(uri);
            } else {
                this.browserService.launch(uri.toString());
            }
            return true;
        }
        return false;
    }
}
