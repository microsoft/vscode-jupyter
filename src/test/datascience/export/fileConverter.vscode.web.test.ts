/* eslint-disable @typescript-eslint/no-explicit-any */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { anything, instance, mock, verify, when } from 'ts-mockito';
import * as sinon from 'sinon';
import { Uri } from 'vscode';
import { IApplicationShell } from '../../../platform/common/application/types';
import { IConfigurationService, IWatchableJupyterSettings } from '../../../platform/common/types';
import { ExportFileOpener } from '../../../platform/export/exportFileOpener';
import { FileConverter } from '../../../platform/export/fileConverter.web';
import { IExport, IExportDialog, ExportFormat } from '../../../platform/export/types';

suite('DataScience - File Converter', () => {
    let fileConverter: FileConverter;
    let exportPythonPlain: IExport;
    let filePicker: IExportDialog;
    let appShell: IApplicationShell;
    let exportFileOpener: ExportFileOpener;
    let configuration: IConfigurationService;
    let settings: IWatchableJupyterSettings;
    setup(async () => {
        filePicker = mock<IExportDialog>();
        exportPythonPlain = mock<IExport>();
        appShell = mock<IApplicationShell>();
        exportFileOpener = mock<ExportFileOpener>();
        configuration = mock<IConfigurationService>();
        settings = mock<IWatchableJupyterSettings>();
        when(configuration.getSettings(anything())).thenReturn(instance(settings));
        when(settings.pythonExportMethod).thenReturn('direct');
        when(filePicker.showDialog(anything(), anything(), anything())).thenReturn(
            Promise.resolve(Uri.file('test.py'))
        );
        when(appShell.showErrorMessage(anything())).thenResolve();
        when(exportPythonPlain.export(anything(), anything(), anything())).thenResolve();
        when(filePicker.showDialog(anything(), anything())).thenResolve(Uri.file('foo'));
        when(exportFileOpener.openFile(anything(), anything(), anything())).thenResolve();
        fileConverter = new FileConverter(
            instance(exportPythonPlain),
            instance(filePicker),
            instance(exportFileOpener)
        );
    });
    teardown(() => sinon.restore());

    test('Export to Python is called when export method is Python', async () => {
        await fileConverter.export(ExportFormat.python, {} as any);
        verify(exportPythonPlain.export(anything(), anything(), anything())).once();
        verify(exportFileOpener.openFile(ExportFormat.python, anything(), anything())).once();
    });
});
