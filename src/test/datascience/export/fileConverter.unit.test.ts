// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { assert } from 'chai';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import * as sinon from 'sinon';
import { Uri } from 'vscode';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import { IConfigurationService, IDisposable, IWatchableJupyterSettings } from '../../../platform/common/types';
import { ExportFileOpener } from '../../../notebooks/export/exportFileOpener';
import { ExportInterpreterFinder } from '../../../notebooks/export/exportInterpreterFinder.node';
import { ExportUtil, ExportUtilNode } from '../../../notebooks/export/exportUtil.node';
import { FileConverter } from '../../../notebooks/export/fileConverter.node';
import { ExportFormat } from '../../../notebooks/export/types';
import { ProgressReporter } from '../../../platform/progress/progressReporter';
import { ServiceContainer } from '../../../platform/ioc/container';
import { IFileSystem } from '../../../platform/common/platform/types';
import { ExportToPDF } from '../../../notebooks/export/exportToPDF';
import { ExportToHTML } from '../../../notebooks/export/exportToHTML';
import { ExportDialog } from '../../../notebooks/export/exportDialog';
import { ExportToPythonPlain } from '../../../notebooks/export/exportToPythonPlain';
import { mockedVSCodeNamespaces } from '../../vscode-mock';

suite('File Converter @export', () => {
    let fileConverter: FileConverter;
    let fileSystem: IFileSystemNode;
    let exportUtil: ExportUtil;
    let exportFileOpener: sinon.SinonStub<
        [format: ExportFormat, uri: Uri, openDirectly?: boolean | undefined],
        Promise<void>
    >;
    let exportInterpreterFinder: ExportInterpreterFinder;
    let configuration: IConfigurationService;
    let settings: IWatchableJupyterSettings;
    setup(async () => {
        exportUtil = mock<ExportUtil>();
        const reporter = mock(ProgressReporter);
        fileSystem = mock<IFileSystemNode>();
        exportInterpreterFinder = mock<ExportInterpreterFinder>();
        configuration = mock<IConfigurationService>();
        settings = mock<IWatchableJupyterSettings>();
        when(configuration.getSettings(anything())).thenReturn(instance(settings));
        when(settings.pythonExportMethod).thenReturn('direct');
        // eslint-disable-next-line no-empty,@typescript-eslint/no-empty-function
        when(mockedVSCodeNamespaces.window.showErrorMessage(anything())).thenResolve();
        // eslint-disable-next-line no-empty,@typescript-eslint/no-empty-function
        sinon.stub(ExportUtilNode.prototype, 'generateTempDir').resolves({ path: 'test', dispose: () => {} });
        sinon.stub(ExportUtilNode.prototype, 'makeFileInDirectory').resolves('foo');
        when(exportUtil.getTargetFile(anything(), anything(), anything())).thenResolve(Uri.file('bar'));
        // eslint-disable-next-line no-empty,@typescript-eslint/no-empty-function
        when(fileSystem.createTemporaryLocalFile(anything())).thenResolve({ filePath: 'test', dispose: () => {} });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sinon.stub(ExportDialog.prototype, 'showDialog').callsFake((_, __, c) => {
            return c ? Promise.resolve(Uri.file('test.pdf')) : Promise.resolve(Uri.file('foo'));
        });
        when(exportInterpreterFinder.getExportInterpreter(anything())).thenResolve();
        exportFileOpener = sinon.stub(ExportFileOpener.prototype, 'openFile').resolves();
        sinon.stub(ServiceContainer, 'instance').get(() => ({
            get: (id: unknown) => (id == IFileSystem ? instance(fileSystem) : undefined)
        }));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        when(reporter.createProgressIndicator(anything(), anything())).thenReturn(instance(mock<IDisposable>()) as any);
        fileConverter = new FileConverter(
            instance(exportUtil),
            instance(fileSystem),
            instance(reporter),
            instance(configuration)
        );

        // Stub out the getContent inner method of the ExportManager we don't care about the content returned
        const getContentStub = sinon.stub(ExportUtil.prototype, 'getContent' as any);
        getContentStub.resolves('teststring');
    });
    teardown(() => sinon.restore());

    test('Erorr message is shown if export fails', async () => {
        sinon.stub(ExportToHTML.prototype, 'export').rejects(new Error('failed...'));

        await fileConverter.export(ExportFormat.html, {} as any);

        verify(mockedVSCodeNamespaces.window.showErrorMessage(anything())).once();
        assert.strictEqual(exportFileOpener.callCount, 0);
    });
    test('Export to PDF is called when export method is PDF', async () => {
        const exportToPdf = sinon.stub(ExportToPDF.prototype, 'export').resolves();

        await fileConverter.export(ExportFormat.pdf, {} as any);

        assert.strictEqual(exportToPdf.callCount, 1);
        assert.strictEqual(exportFileOpener.callCount, 1);
        assert.strictEqual(exportFileOpener.getCall(0).args[0], ExportFormat.pdf);
    });
    test('Export to HTML is called when export method is HTML', async () => {
        const exportToHtml = sinon.stub(ExportToHTML.prototype, 'export').resolves();

        await fileConverter.export(ExportFormat.html, {} as any);

        assert.strictEqual(exportToHtml.callCount, 1);
        assert.strictEqual(exportFileOpener.callCount, 1);
        assert.strictEqual(exportFileOpener.getCall(0).args[0], ExportFormat.html);
    });
    test('Export to Python is called when export method is Python', async () => {
        const exportToPython = sinon.stub(ExportToPythonPlain.prototype, 'export').resolves();

        await fileConverter.export(ExportFormat.python, {} as any);

        assert.strictEqual(exportToPython.callCount, 1);
        assert.strictEqual(exportFileOpener.callCount, 1);
        assert.strictEqual(exportFileOpener.getCall(0).args[0], ExportFormat.python);
    });
});
