// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri, Disposable } from 'vscode';
import { createDocument } from '../../test/datascience/editor-integration/helpers';
import * as TypeMoq from 'typemoq';
import { CodeLensFactory } from './codeLensFactory';
import { IConfigurationService } from '../../platform/common/types';
import { CellRangeCache } from './cellRangeCache';
import { IKernelProvider } from '../../kernels/types';
import { mockedVSCodeNamespaces } from '../../test/vscode-mock';
import { IGeneratedCodeStorageFactory } from './types';
import { IReplNotebookTrackerService } from '../../platform/notebooks/replNotebookTrackerService';
import { when, anything, verify } from 'ts-mockito';

suite('DataScienceCodeLensProvider Unit Tests', () => {
    let codeLensFactory: CodeLensFactory;
    let configService: TypeMoq.IMock<IConfigurationService>;

    const storageFactory = TypeMoq.Mock.ofType<IGeneratedCodeStorageFactory>();
    const kernelProvider = TypeMoq.Mock.ofType<IKernelProvider>();
    const replTracker = TypeMoq.Mock.ofType<IReplNotebookTrackerService>();
    const disposables: Disposable[] = [];

    setup(() => {
        configService = TypeMoq.Mock.ofType<IConfigurationService>();

        codeLensFactory = new CodeLensFactory(
            configService.object,
            disposables,
            storageFactory.object,
            kernelProvider.object,
            replTracker.object,
            new CellRangeCache(configService.object)
        );

        when(mockedVSCodeNamespaces.commands.executeCommand(anything(), anything(), anything())).thenResolve();
    });

    test('Having code lenses will update context keys to true', async () => {
        when(configService.object.getSettings(anything())).thenReturn({
            sendSelectionToInteractiveWindow: false
        } as any);

        const fileName = Uri.file('test.py').fsPath;
        const version = 1;
        const inputText = `# %%\nprint(1)`;
        const document = createDocument(inputText, fileName, version, TypeMoq.Times.atLeastOnce(), true);

        codeLensFactory.getCellRanges(document.object);

        // verify context keys set
        verify(mockedVSCodeNamespaces.commands.executeCommand('setContext', 'jupyter.ownsSelection', true)).atLeast(1);
        verify(mockedVSCodeNamespaces.commands.executeCommand('setContext', 'jupyter.hascodecells', true)).atLeast(1);
    });

    test('Having no code lenses will set context keys to false', async () => {
        when(configService.object.getSettings(anything())).thenReturn({
            sendSelectionToInteractiveWindow: false
        } as any);

        const fileName = Uri.file('test.py').fsPath;
        const version = 1;
        const inputText = `print(1)`;
        const document = createDocument(inputText, fileName, version, TypeMoq.Times.atLeastOnce(), true);

        codeLensFactory.getCellRanges(document.object);

        // verify context keys set
        verify(mockedVSCodeNamespaces.commands.executeCommand('setContext', 'jupyter.ownsSelection', true)).atLeast(1);
        verify(mockedVSCodeNamespaces.commands.executeCommand('setContext', 'jupyter.hascodecells', true)).atLeast(1);
    });

    test('Having no code lenses but ownership setting true will set context keys correctly', async () => {
        when(configService.object.getSettings(anything())).thenReturn({
            sendSelectionToInteractiveWindow: true
        } as any);

        const fileName = Uri.file('test.py').fsPath;
        const version = 1;
        const inputText = `print(1)`;
        const document = createDocument(inputText, fileName, version, TypeMoq.Times.atLeastOnce(), true);

        codeLensFactory.getCellRanges(document.object);

        // verify context keys set
        verify(mockedVSCodeNamespaces.commands.executeCommand('setContext', 'jupyter.ownsSelection', true)).atLeast(1);
        verify(mockedVSCodeNamespaces.commands.executeCommand('setContext', 'jupyter.hascodecells', true)).atLeast(1);
    });
});
