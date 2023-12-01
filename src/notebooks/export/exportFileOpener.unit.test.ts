// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { anything, instance, mock, reset, verify, when } from 'ts-mockito';
import { TextEditor, Uri } from 'vscode';
import { IFileSystem } from '../../platform/common/platform/types';
import { IDisposable } from '../../platform/common/types';
import { ExportFileOpener } from './exportFileOpener';
import { ExportFormat } from './types';
import { ProgressReporter } from '../../platform/progress/progressReporter';
import { mockedVSCodeNamespaces } from '../../test/vscode-mock';

suite('Export File Opener', () => {
    let fileOpener: ExportFileOpener;
    let fileSystem: IFileSystem;
    setup(async () => {
        fileSystem = mock<IFileSystem>();
        const reporter = mock(ProgressReporter);
        const editor = mock<TextEditor>();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (instance(editor) as any).then = undefined;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        when(reporter.createProgressIndicator(anything())).thenReturn(instance(mock<IDisposable>()) as any);
        when(mockedVSCodeNamespaces.workspace.openTextDocument(anything())).thenResolve();
        when(mockedVSCodeNamespaces.window.showTextDocument(anything())).thenReturn(Promise.resolve(instance(editor)));
        when(fileSystem.readFile(anything())).thenResolve();
        reset(mockedVSCodeNamespaces.env);
        when(mockedVSCodeNamespaces.env.openExternal(anything())).thenReturn(Promise.resolve(true));
        fileOpener = new ExportFileOpener(instance(fileSystem));
    });

    test('Python File is opened if exported', async () => {
        const uri = Uri.file('test.python');
        await fileOpener.openFile(ExportFormat.python, uri);

        verify(mockedVSCodeNamespaces.window.showTextDocument(anything())).once();
    });
    test('HTML File opened if yes button pressed', async () => {
        const uri = Uri.file('test.html');
        when(mockedVSCodeNamespaces.window.showInformationMessage(anything(), anything(), anything())).thenReturn(
            Promise.resolve('Yes')
        );

        await fileOpener.openFile(ExportFormat.html, uri);

        verify(mockedVSCodeNamespaces.env.openExternal(anything())).once();
    });
    test('HTML File not opened if no button button pressed', async () => {
        const uri = Uri.file('test.html');
        when(mockedVSCodeNamespaces.window.showInformationMessage(anything(), anything(), anything())).thenReturn(
            Promise.resolve('No')
        );

        await fileOpener.openFile(ExportFormat.html, uri);

        verify(mockedVSCodeNamespaces.env.openExternal(anything())).never();
    });
    test('PDF File opened if yes button pressed', async () => {
        const uri = Uri.file('test.pdf');
        when(mockedVSCodeNamespaces.window.showInformationMessage(anything(), anything(), anything())).thenReturn(
            Promise.resolve('Yes')
        );

        await fileOpener.openFile(ExportFormat.pdf, uri);

        verify(mockedVSCodeNamespaces.env.openExternal(anything())).once();
    });
    test('PDF File not opened if no button button pressed', async () => {
        const uri = Uri.file('test.pdf');
        when(mockedVSCodeNamespaces.window.showInformationMessage(anything(), anything(), anything())).thenReturn(
            Promise.resolve('No')
        );

        await fileOpener.openFile(ExportFormat.pdf, uri);

        verify(mockedVSCodeNamespaces.env.openExternal(anything())).never();
    });
});
