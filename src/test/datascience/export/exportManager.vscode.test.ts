// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { anything, instance, mock, verify, when } from 'ts-mockito';
import { Uri } from 'vscode';

import { IApplicationShell } from '../../../client/common/application/types';
import { IFileSystem } from '../../../client/common/platform/types';
import { IDisposable } from '../../../client/common/types';
import { ExportFileOpener } from '../../../client/datascience/export/exportFileOpener';
import { ExportInterpreterFinder } from '../../../client/datascience/export/exportInterpreterFinder';
import { ExportManager } from '../../../client/datascience/export/exportManager';
import { ExportUtil } from '../../../client/datascience/export/exportUtil';
import { ExportFormat, IExport, IExportDialog } from '../../../client/datascience/export/types';
import { ProgressReporter } from '../../../client/datascience/progress/progressReporter';

suite('DataScience - Export Manager', () => {
    let exporter: ExportManager;
    let exportPython: IExport;
    let exportHtml: IExport;
    let exportPdf: IExport;
    let fileSystem: IFileSystem;
    let exportUtil: ExportUtil;
    let filePicker: IExportDialog;
    let appShell: IApplicationShell;
    let exportFileOpener: ExportFileOpener;
    let exportInterpreterFinder: ExportInterpreterFinder;
    setup(async () => {
        exportUtil = mock<ExportUtil>();
        const reporter = mock(ProgressReporter);
        filePicker = mock<IExportDialog>();
        fileSystem = mock<IFileSystem>();
        exportPython = mock<IExport>();
        exportHtml = mock<IExport>();
        exportPdf = mock<IExport>();
        appShell = mock<IApplicationShell>();
        exportFileOpener = mock<ExportFileOpener>();
        exportInterpreterFinder = mock<ExportInterpreterFinder>();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        when(filePicker.showDialog(anything(), anything(), anything())).thenReturn(
            Promise.resolve(Uri.file('test.pdf'))
        );
        // eslint-disable-next-line no-empty,@typescript-eslint/no-empty-function
        when(appShell.showErrorMessage(anything())).thenResolve();
        // eslint-disable-next-line no-empty,@typescript-eslint/no-empty-function
        when(exportUtil.generateTempDir()).thenResolve({ path: 'test', dispose: () => {} });
        when(exportUtil.makeFileInDirectory(anything(), anything(), anything())).thenResolve('foo');
        // eslint-disable-next-line no-empty,@typescript-eslint/no-empty-function
        when(fileSystem.createTemporaryLocalFile(anything())).thenResolve({ filePath: 'test', dispose: () => {} });
        when(exportPdf.export(anything(), anything(), anything(), anything())).thenResolve();
        when(filePicker.showDialog(anything(), anything())).thenResolve(Uri.file('foo'));
        when(exportInterpreterFinder.getExportInterpreter(anything())).thenResolve();
        when(exportFileOpener.openFile(anything(), anything())).thenResolve();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        when(reporter.createProgressIndicator(anything(), anything())).thenReturn(instance(mock<IDisposable>()) as any);
        exporter = new ExportManager(
            instance(exportPdf),
            instance(exportHtml),
            instance(exportPython),
            instance(fileSystem),
            instance(filePicker),
            instance(reporter),
            instance(exportUtil),
            instance(appShell),
            instance(exportFileOpener),
            instance(exportInterpreterFinder)
        );
    });

    test('Remove svg is called when exporting to PDF', async () => {
        await exporter.export(ExportFormat.pdf, 'model', Uri.file('foo'));
        verify(exportUtil.removeSvgs(anything())).once();
    });
    test('Erorr message is shown if export fails', async () => {
        when(exportHtml.export(anything(), anything(), anything(), anything())).thenThrow(new Error('failed...'));
        await exporter.export(ExportFormat.html, 'model', Uri.file('foo'));
        verify(appShell.showErrorMessage(anything())).once();
        verify(exportFileOpener.openFile(anything(), anything())).never();
    });
    test('Export to PDF is called when export method is PDF', async () => {
        await exporter.export(ExportFormat.pdf, 'model', Uri.file('foo'));
        verify(exportPdf.export(anything(), anything(), anything(), anything())).once();
        verify(exportFileOpener.openFile(ExportFormat.pdf, anything())).once();
    });
    test('Export to HTML is called when export method is HTML', async () => {
        await exporter.export(ExportFormat.html, 'model', Uri.file('foo'));
        verify(exportHtml.export(anything(), anything(), anything(), anything())).once();
        verify(exportFileOpener.openFile(ExportFormat.html, anything())).once();
    });
    test('Export to Python is called when export method is Python', async () => {
        await exporter.export(ExportFormat.python, 'model', Uri.file('foo'));
        verify(exportPython.export(anything(), anything(), anything(), anything())).once();
        verify(exportFileOpener.openFile(ExportFormat.python, anything())).once();
    });
});
