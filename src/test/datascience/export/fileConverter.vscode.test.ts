// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { anything, instance, mock, verify, when } from 'ts-mockito';
import * as sinon from 'sinon';
import { Uri } from 'vscode';
import { IApplicationShell } from '../../../platform/common/application/types';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import { IConfigurationService, IDisposable, IWatchableJupyterSettings } from '../../../platform/common/types';
import { ExportFileOpener } from '../../../notebooks/export/exportFileOpener';
import { ExportInterpreterFinder } from '../../../notebooks/export/exportInterpreterFinder.node';
import { ExportUtil } from '../../../notebooks/export/exportUtil.node';
import { FileConverter } from '../../../notebooks/export/fileConverter.node';
import { INbConvertExport, IExport, IExportDialog, ExportFormat } from '../../../notebooks/export/types';
import { ProgressReporter } from '../../../platform/progress/progressReporter';

suite('File Converter @export', () => {
    let fileConverter: FileConverter;
    let exportPython: INbConvertExport;
    let exportHtml: INbConvertExport;
    let exportPdf: INbConvertExport;
    let exportPythonPlain: IExport;
    let fileSystem: IFileSystemNode;
    let exportUtil: ExportUtil;
    let filePicker: IExportDialog;
    let appShell: IApplicationShell;
    let exportFileOpener: ExportFileOpener;
    let exportInterpreterFinder: ExportInterpreterFinder;
    let configuration: IConfigurationService;
    let settings: IWatchableJupyterSettings;
    setup(async () => {
        exportUtil = mock<ExportUtil>();
        const reporter = mock(ProgressReporter);
        filePicker = mock<IExportDialog>();
        fileSystem = mock<IFileSystemNode>();
        exportPython = mock<INbConvertExport>();
        exportHtml = mock<INbConvertExport>();
        exportPdf = mock<INbConvertExport>();
        exportPythonPlain = mock<IExport>();
        appShell = mock<IApplicationShell>();
        exportFileOpener = mock<ExportFileOpener>();
        exportInterpreterFinder = mock<ExportInterpreterFinder>();
        configuration = mock<IConfigurationService>();
        settings = mock<IWatchableJupyterSettings>();
        when(configuration.getSettings(anything())).thenReturn(instance(settings));
        when(settings.pythonExportMethod).thenReturn('direct');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        when(filePicker.showDialog(anything(), anything(), anything())).thenReturn(
            Promise.resolve(Uri.file('test.pdf'))
        );
        // eslint-disable-next-line no-empty,@typescript-eslint/no-empty-function
        when(appShell.showErrorMessage(anything())).thenResolve();
        // eslint-disable-next-line no-empty,@typescript-eslint/no-empty-function
        when(exportUtil.generateTempDir()).thenResolve({ path: 'test', dispose: () => {} });
        when(exportUtil.makeFileInDirectory(anything(), anything(), anything())).thenResolve('foo');
        when(exportUtil.getTargetFile(anything(), anything(), anything())).thenResolve(Uri.file('bar'));
        // eslint-disable-next-line no-empty,@typescript-eslint/no-empty-function
        when(fileSystem.createTemporaryLocalFile(anything())).thenResolve({ filePath: 'test', dispose: () => {} });
        when(exportPdf.export(anything(), anything(), anything(), anything())).thenResolve();
        when(exportPythonPlain.export(anything(), anything(), anything())).thenResolve();
        when(filePicker.showDialog(anything(), anything())).thenResolve(Uri.file('foo'));
        when(exportInterpreterFinder.getExportInterpreter(anything())).thenResolve();
        when(exportFileOpener.openFile(anything(), anything())).thenResolve();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        when(reporter.createProgressIndicator(anything(), anything())).thenReturn(instance(mock<IDisposable>()) as any);
        fileConverter = new FileConverter(
            instance(exportPdf),
            instance(exportHtml),
            instance(exportPython),
            instance(exportPythonPlain),
            instance(exportUtil),
            instance(fileSystem),
            instance(filePicker),
            instance(reporter),
            instance(appShell),
            instance(exportFileOpener),
            instance(configuration)
        );

        // Stub out the getContent inner method of the ExportManager we don't care about the content returned
        const getContentStub = sinon.stub(ExportUtil.prototype, 'getContent' as any);
        getContentStub.resolves('teststring');
    });
    teardown(() => sinon.restore());

    test('Erorr message is shown if export fails', async () => {
        when(exportHtml.export(anything(), anything(), anything(), anything())).thenThrow(new Error('failed...'));
        await fileConverter.export(ExportFormat.html, {} as any);
        verify(appShell.showErrorMessage(anything())).once();
        verify(exportFileOpener.openFile(anything(), anything())).never();
    });
    test('Export to PDF is called when export method is PDF', async () => {
        await fileConverter.export(ExportFormat.pdf, {} as any);
        verify(exportPdf.export(anything(), anything(), anything(), anything())).once();
        verify(exportFileOpener.openFile(ExportFormat.pdf, anything())).once();
    });
    test('Export to HTML is called when export method is HTML', async () => {
        await fileConverter.export(ExportFormat.html, {} as any);
        verify(exportHtml.export(anything(), anything(), anything(), anything())).once();
        verify(exportFileOpener.openFile(ExportFormat.html, anything())).once();
    });
    test('Export to Python is called when export method is Python', async () => {
        await fileConverter.export(ExportFormat.python, {} as any);
        verify(exportPythonPlain.export(anything(), anything(), anything())).once();
        verify(exportFileOpener.openFile(ExportFormat.python, anything())).once();
    });
});
