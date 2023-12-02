// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Position, TextEditor, Uri, window, workspace } from 'vscode';
import { sendTelemetryEvent } from '../../telemetry';
import { Telemetry, PYTHON_LANGUAGE } from '../../platform/common/constants';
import { IFileSystem } from '../../platform/common/platform/types';
import * as localize from '../../platform/common/utils/localize';
import { noop } from '../../platform/common/utils/misc';
import { ExportFormat } from './types';
import { openInBrowser } from '../../platform/common/net/browser';
import { ServiceContainer } from '../../platform/ioc/container';

/**
 * Used to handle opening the results of an export
 */
export class ExportFileOpener {
    private readonly fs: IFileSystem;
    constructor() {
        this.fs = ServiceContainer.instance.get<IFileSystem>(IFileSystem);
    }

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
            editor = await window.showTextDocument(uri);
        } else {
            const contents = await this.fs.readFile(uri);
            await this.fs.delete(uri);
            const doc = await workspace.openTextDocument({ language: PYTHON_LANGUAGE, content: contents });
            editor = await window.showTextDocument(doc);
        }

        // Edit the document so that it is dirty (add a space at the end)
        await editor.edit((editBuilder) => {
            editBuilder.insert(new Position(editor.document.lineCount, 0), '\n');
        });
    }

    private async askOpenFile(uri: Uri, openDirectly: boolean): Promise<boolean> {
        const yes = localize.DataScience.openExportFileYes;
        const no = localize.DataScience.openExportFileNo;
        const items = [yes, no];

        const selected = await window
            .showInformationMessage(localize.DataScience.openExportedFileMessage, ...items)
            .then((item) => item);

        if (selected === yes) {
            if (openDirectly) {
                window.showTextDocument(uri).then(noop, noop);
            } else {
                openInBrowser(uri.toString());
            }
            return true;
        }
        return false;
    }
}
