// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { instance, mock, when } from 'ts-mockito';
import * as TypeMoq from 'typemoq';
import { CancellationTokenSource, Disposable, EventEmitter, TextDocument, Uri } from 'vscode';

import {
    ICommandManager,
    IDebugService,
    IDocumentManager,
    IVSCodeNotebook,
    IWorkspaceService
} from '../../../client/common/application/types';
import { IFileSystem } from '../../../client/common/platform/types';
import { IConfigurationService, IWatchableJupyterSettings } from '../../../client/common/types';
import { DataScienceCodeLensProvider } from '../../../client/datascience/editor-integration/codelensprovider';
import { ICodeWatcher, IDataScienceCodeLensProvider, IDebugLocationTracker } from '../../../client/datascience/types';
import { IServiceContainer } from '../../../client/ioc/types';

// eslint-disable-next-line
suite('DataScienceCodeLensProvider Unit Tests', () => {
    let serviceContainer: TypeMoq.IMock<IServiceContainer>;
    let configurationService: TypeMoq.IMock<IConfigurationService>;
    let codeLensProvider: IDataScienceCodeLensProvider;
    let pythonSettings: TypeMoq.IMock<IWatchableJupyterSettings>;
    let documentManager: TypeMoq.IMock<IDocumentManager>;
    let commandManager: TypeMoq.IMock<ICommandManager>;
    let debugService: TypeMoq.IMock<IDebugService>;
    let debugLocationTracker: TypeMoq.IMock<IDebugLocationTracker>;
    let fileSystem: TypeMoq.IMock<IFileSystem>;
    let tokenSource: CancellationTokenSource;
    let vscodeNotebook: TypeMoq.IMock<IVSCodeNotebook>;
    const disposables: Disposable[] = [];

    setup(() => {
        tokenSource = new CancellationTokenSource();
        serviceContainer = TypeMoq.Mock.ofType<IServiceContainer>();
        configurationService = TypeMoq.Mock.ofType<IConfigurationService>();
        documentManager = TypeMoq.Mock.ofType<IDocumentManager>();
        commandManager = TypeMoq.Mock.ofType<ICommandManager>();
        debugService = TypeMoq.Mock.ofType<IDebugService>();
        debugLocationTracker = TypeMoq.Mock.ofType<IDebugLocationTracker>();
        pythonSettings = TypeMoq.Mock.ofType<IWatchableJupyterSettings>();
        fileSystem = TypeMoq.Mock.ofType<IFileSystem>();
        vscodeNotebook = TypeMoq.Mock.ofType<IVSCodeNotebook>();
        const workspace = mock<IWorkspaceService>();
        when(workspace.isTrusted).thenReturn(true);
        when(workspace.onDidGrantWorkspaceTrust).thenReturn(new EventEmitter<void>().event);
        configurationService.setup((c) => c.getSettings(TypeMoq.It.isAny())).returns(() => pythonSettings.object);
        vscodeNotebook.setup((c) => c.activeNotebookEditor).returns(() => undefined);
        commandManager
            .setup((c) => c.executeCommand(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve());
        debugService.setup((d) => d.activeDebugSession).returns(() => undefined);
        fileSystem
            .setup((f) => f.areLocalPathsSame(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns((a, b) => {
                return a.toLowerCase() === b.toLowerCase();
            });
        codeLensProvider = new DataScienceCodeLensProvider(
            serviceContainer.object,
            debugLocationTracker.object,
            documentManager.object,
            configurationService.object,
            commandManager.object,
            disposables,
            debugService.object,
            fileSystem.object,
            instance(workspace)
        );
    });

    test('Initialize Code Lenses one document', async () => {
        // Create our document
        const document = TypeMoq.Mock.ofType<TextDocument>();
        document.setup((d) => d.fileName).returns(() => 'test.py');
        document.setup((d) => d.version).returns(() => 1);

        const targetCodeWatcher = TypeMoq.Mock.ofType<ICodeWatcher>();
        targetCodeWatcher
            .setup((tc) => tc.getCodeLenses())
            .returns(() => [])
            .verifiable(TypeMoq.Times.once());
        serviceContainer
            .setup((c) => c.get(TypeMoq.It.isValue(ICodeWatcher)))
            .returns(() => targetCodeWatcher.object)
            .verifiable(TypeMoq.Times.once());
        documentManager.setup((d) => d.textDocuments).returns(() => [document.object]);

        await codeLensProvider.provideCodeLenses(document.object, tokenSource.token);

        targetCodeWatcher.verifyAll();
        serviceContainer.verifyAll();
    });

    test('Initialize Code Lenses same doc called', async () => {
        // Create our document
        const document = TypeMoq.Mock.ofType<TextDocument>();
        const uri = Uri.file('test.py');
        document.setup((d) => d.fileName).returns(() => uri.fsPath);
        document.setup((d) => d.version).returns(() => 1);

        const targetCodeWatcher = TypeMoq.Mock.ofType<ICodeWatcher>();
        targetCodeWatcher
            .setup((tc) => tc.getCodeLenses())
            .returns(() => [])
            .verifiable(TypeMoq.Times.exactly(2));
        targetCodeWatcher.setup((tc) => tc.uri).returns(() => uri);
        targetCodeWatcher.setup((tc) => tc.getVersion()).returns(() => 1);
        serviceContainer
            .setup((c) => c.get(TypeMoq.It.isValue(ICodeWatcher)))
            .returns(() => {
                return targetCodeWatcher.object;
            })
            .verifiable(TypeMoq.Times.once());
        documentManager.setup((d) => d.textDocuments).returns(() => [document.object]);

        await codeLensProvider.provideCodeLenses(document.object, tokenSource.token);
        await codeLensProvider.provideCodeLenses(document.object, tokenSource.token);

        // getCodeLenses should be called twice, but getting the code watcher only once due to same doc
        targetCodeWatcher.verifyAll();
        serviceContainer.verifyAll();
    });

    test('Initialize Code Lenses new name / version', async () => {
        // Create our document
        const document = TypeMoq.Mock.ofType<TextDocument>();
        document.setup((d) => d.fileName).returns(() => 'test.py');
        document.setup((d) => d.version).returns(() => 1);

        const document2 = TypeMoq.Mock.ofType<TextDocument>();
        document2.setup((d) => d.fileName).returns(() => 'test2.py');
        document2.setup((d) => d.version).returns(() => 1);

        const document3 = TypeMoq.Mock.ofType<TextDocument>();
        document3.setup((d) => d.fileName).returns(() => 'test.py');
        document3.setup((d) => d.version).returns(() => 2);

        const targetCodeWatcher = TypeMoq.Mock.ofType<ICodeWatcher>();
        targetCodeWatcher
            .setup((tc) => tc.getCodeLenses())
            .returns(() => [])
            .verifiable(TypeMoq.Times.exactly(3));
        targetCodeWatcher.setup((tc) => tc.uri).returns(() => Uri.file('test.py'));
        targetCodeWatcher.setup((tc) => tc.getVersion()).returns(() => 1);
        serviceContainer
            .setup((c) => c.get(TypeMoq.It.isValue(ICodeWatcher)))
            .returns(() => targetCodeWatcher.object)
            .verifiable(TypeMoq.Times.exactly(3));
        documentManager
            .setup((d) => d.textDocuments)
            .returns(() => [document.object, document2.object, document3.object]);

        await codeLensProvider.provideCodeLenses(document.object, tokenSource.token);
        await codeLensProvider.provideCodeLenses(document2.object, tokenSource.token);
        await codeLensProvider.provideCodeLenses(document3.object, tokenSource.token);

        // service container get should be called three times as the names and versions don't match
        targetCodeWatcher.verifyAll();
        serviceContainer.verifyAll();
    });
});
