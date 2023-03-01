// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { anything, instance, mock, verify, when } from 'ts-mockito';
import { TextEditor, Uri } from 'vscode';
import { IApplicationShell, IDocumentManager } from '../../platform/common/application/types';
import { IFileSystem } from '../../platform/common/platform/types';
import { IBrowserService, IDisposable } from '../../platform/common/types';
import { ExportFileOpener } from './exportFileOpener';
import { ExportFormat } from './types';
import { ProgressReporter } from '../../platform/progress/progressReporter';
import { getLocString } from '../../webviews/webview-side/react-common/locReactSide';

suite('Export File Opener', () => {
    let fileOpener: ExportFileOpener;
    let documentManager: IDocumentManager;
    let fileSystem: IFileSystem;
    let applicationShell: IApplicationShell;
    let browserService: IBrowserService;
    setup(async () => {
        documentManager = mock<IDocumentManager>();
        fileSystem = mock<IFileSystem>();
        applicationShell = mock<IApplicationShell>();
        browserService = mock<IBrowserService>();
        const reporter = mock(ProgressReporter);
        const editor = mock<TextEditor>();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (instance(editor) as any).then = undefined;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        when(reporter.createProgressIndicator(anything())).thenReturn(instance(mock<IDisposable>()) as any);
        when(documentManager.openTextDocument(anything())).thenResolve();
        when(documentManager.showTextDocument(anything())).thenReturn(Promise.resolve(instance(editor)));
        when(fileSystem.readFile(anything())).thenResolve();
        fileOpener = new ExportFileOpener(
            instance(documentManager),
            instance(fileSystem),
            instance(applicationShell),
            instance(browserService)
        );
    });

    test('Python File is opened if exported', async () => {
        const uri = Uri.file('test.python');
        await fileOpener.openFile(ExportFormat.python, uri);

        verify(documentManager.showTextDocument(anything())).once();
    });
    test('HTML File opened if yes button pressed', async () => {
        const uri = Uri.file('test.html');
        when(applicationShell.showInformationMessage(anything(), anything(), anything())).thenReturn(
            Promise.resolve(getLocString('openExportFileYes', 'Yes'))
        );

        await fileOpener.openFile(ExportFormat.html, uri);

        verify(browserService.launch(anything())).once();
    });
    test('HTML File not opened if no button button pressed', async () => {
        const uri = Uri.file('test.html');
        when(applicationShell.showInformationMessage(anything(), anything(), anything())).thenReturn(
            Promise.resolve(getLocString('openExportFileNo', 'No'))
        );

        await fileOpener.openFile(ExportFormat.html, uri);

        verify(browserService.launch(anything())).never();
    });
    test('PDF File opened if yes button pressed', async () => {
        const uri = Uri.file('test.pdf');
        when(applicationShell.showInformationMessage(anything(), anything(), anything())).thenReturn(
            Promise.resolve(getLocString('openExportFileYes', 'Yes'))
        );

        await fileOpener.openFile(ExportFormat.pdf, uri);

        verify(browserService.launch(anything())).once();
    });
    test('PDF File not opened if no button button pressed', async () => {
        const uri = Uri.file('test.pdf');
        when(applicationShell.showInformationMessage(anything(), anything(), anything())).thenReturn(
            Promise.resolve(getLocString('openExportFileNo', 'No'))
        );

        await fileOpener.openFile(ExportFormat.pdf, uri);

        verify(browserService.launch(anything())).never();
    });
});
