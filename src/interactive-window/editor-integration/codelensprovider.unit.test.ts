// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { anything, when } from 'ts-mockito';
import * as TypeMoq from 'typemoq';
import { CancellationTokenSource, CodeLens, Disposable, EventEmitter, TextDocument, Uri } from 'vscode';

import { IDebugService } from '../../platform/common/application/types';
import { IConfigurationService, IWatchableJupyterSettings } from '../../platform/common/types';
import { DataScienceCodeLensProvider } from '../../interactive-window/editor-integration/codelensprovider';
import { IServiceContainer } from '../../platform/ioc/types';
import { ICodeWatcher } from '../../interactive-window/editor-integration/types';
import { IDebugLocationTracker } from '../../notebooks/debugger/debuggingTypes';
import { mockedVSCodeNamespaces } from '../../test/vscode-mock';

// eslint-disable-next-line
suite('DataScienceCodeLensProvider Unit Tests', () => {
    let serviceContainer: TypeMoq.IMock<IServiceContainer>;
    let configurationService: TypeMoq.IMock<IConfigurationService>;
    let pythonSettings: TypeMoq.IMock<IWatchableJupyterSettings>;
    let debugService: TypeMoq.IMock<IDebugService>;
    let debugLocationTracker: TypeMoq.IMock<IDebugLocationTracker>;
    let tokenSource: CancellationTokenSource;
    const disposables: Disposable[] = [];

    setup(() => {
        tokenSource = new CancellationTokenSource();
        serviceContainer = TypeMoq.Mock.ofType<IServiceContainer>();
        configurationService = TypeMoq.Mock.ofType<IConfigurationService>();
        debugService = TypeMoq.Mock.ofType<IDebugService>();
        debugLocationTracker = TypeMoq.Mock.ofType<IDebugLocationTracker>();
        pythonSettings = TypeMoq.Mock.ofType<IWatchableJupyterSettings>();
        when(mockedVSCodeNamespaces.workspace.isTrusted).thenReturn(true);
        when(mockedVSCodeNamespaces.workspace.onDidGrantWorkspaceTrust).thenReturn(new EventEmitter<void>().event);
        when(mockedVSCodeNamespaces.window.activeNotebookEditor).thenReturn(undefined);
        configurationService.setup((c) => c.getSettings(TypeMoq.It.isAny())).returns(() => pythonSettings.object);
        when(mockedVSCodeNamespaces.commands.executeCommand(anything(), anything(), anything())).thenResolve();
        debugService.setup((d) => d.activeDebugSession).returns(() => undefined);
    });

    function provideCodeLensesForOneDoc(codeLenses: CodeLens[] = []) {
        const codeLensProvider = new DataScienceCodeLensProvider(
            serviceContainer.object,
            debugLocationTracker.object,
            configurationService.object,
            disposables,
            debugService.object
        );

        // Create our document
        const document = TypeMoq.Mock.ofType<TextDocument>();
        const uri = Uri.file('test.py');
        document.setup((d) => d.fileName).returns(() => 'test.py');
        document.setup((d) => d.version).returns(() => 1);
        document.setup((d) => d.uri).returns(() => uri);

        const targetCodeWatcher = TypeMoq.Mock.ofType<ICodeWatcher>();
        targetCodeWatcher
            .setup((tc) => tc.getCodeLenses())
            .returns(() => codeLenses)
            .verifiable(TypeMoq.Times.once());
        serviceContainer
            .setup((c) => c.get(TypeMoq.It.isValue(ICodeWatcher)))
            .returns(() => targetCodeWatcher.object)
            .verifiable(TypeMoq.Times.once());
        when(mockedVSCodeNamespaces.workspace.textDocuments).thenReturn([document.object]);

        codeLensProvider.provideCodeLenses(document.object, tokenSource.token);

        return targetCodeWatcher;
    }

    test('Initialize Code Lenses one document', async () => {
        const targetCodeWatcher = provideCodeLensesForOneDoc();

        targetCodeWatcher.verifyAll();
        serviceContainer.verifyAll();
    });

    test('Initialize Code Lenses same doc called', async () => {
        const codeLensProvider = new DataScienceCodeLensProvider(
            serviceContainer.object,
            debugLocationTracker.object,
            configurationService.object,
            disposables,
            debugService.object
        );

        // Create our document
        const document = TypeMoq.Mock.ofType<TextDocument>();
        const uri = Uri.file('test.py');
        document.setup((d) => d.uri).returns(() => uri);
        document.setup((d) => d.version).returns(() => 1);

        const targetCodeWatcher = TypeMoq.Mock.ofType<ICodeWatcher>();
        targetCodeWatcher
            .setup((tc) => tc.getCodeLenses())
            .returns(() => [])
            .verifiable(TypeMoq.Times.exactly(2));
        targetCodeWatcher.setup((tc) => tc.uri).returns(() => uri);
        targetCodeWatcher.setup((tc) => tc.getVersion()).returns(() => 1);
        targetCodeWatcher.setup((tc) => tc.getVersion()).returns(() => 2);
        serviceContainer
            .setup((c) => c.get(TypeMoq.It.isValue(ICodeWatcher)))
            .returns(() => {
                return targetCodeWatcher.object;
            })
            .verifiable(TypeMoq.Times.once());
        when(mockedVSCodeNamespaces.workspace.textDocuments).thenReturn([document.object]);

        codeLensProvider.provideCodeLenses(document.object, tokenSource.token);
        codeLensProvider.provideCodeLenses(document.object, tokenSource.token);

        // getCodeLenses should be called twice, but getting the code watcher only once due to same doc
        targetCodeWatcher.verifyAll();
        serviceContainer.verifyAll();
    });

    test('Initialize Code Lenses different documents', async () => {
        const codeLensProvider = new DataScienceCodeLensProvider(
            serviceContainer.object,
            debugLocationTracker.object,
            configurationService.object,
            disposables,
            debugService.object
        );

        // Create our document
        const uri1 = Uri.file('test.py');
        const document1 = TypeMoq.Mock.ofType<TextDocument>();
        document1.setup((d) => d.uri).returns(() => uri1);
        document1.setup((d) => d.version).returns(() => 1);

        const uri2 = Uri.file('test2.py');
        const document2 = TypeMoq.Mock.ofType<TextDocument>();
        document2.setup((d) => d.uri).returns(() => uri2);
        document2.setup((d) => d.version).returns(() => 1);

        const targetCodeWatcher1 = TypeMoq.Mock.ofType<ICodeWatcher>();
        targetCodeWatcher1
            .setup((tc) => tc.getCodeLenses())
            .returns(() => [])
            .verifiable(TypeMoq.Times.exactly(2));
        const targetCodeWatcher2 = TypeMoq.Mock.ofType<ICodeWatcher>();
        targetCodeWatcher1.setup((tc) => tc.uri).returns(() => uri1);
        targetCodeWatcher1.setup((tc) => tc.getVersion()).returns(() => 1);
        targetCodeWatcher2
            .setup((tc) => tc.getCodeLenses())
            .returns(() => [])
            .verifiable(TypeMoq.Times.once());
        targetCodeWatcher2.setup((tc) => tc.uri).returns(() => uri2);
        targetCodeWatcher2.setup((tc) => tc.getVersion()).returns(() => 1);

        serviceContainer.setup((c) => c.get(TypeMoq.It.isValue(ICodeWatcher))).returns(() => targetCodeWatcher1.object);
        serviceContainer.setup((c) => c.get(TypeMoq.It.isValue(ICodeWatcher))).returns(() => targetCodeWatcher2.object);

        when(mockedVSCodeNamespaces.workspace.textDocuments).thenReturn([document1.object, document2.object]);

        codeLensProvider.provideCodeLenses(document1.object, tokenSource.token);
        codeLensProvider.provideCodeLenses(document1.object, tokenSource.token);
        codeLensProvider.provideCodeLenses(document2.object, tokenSource.token);

        // service container get should be called three times as the names and versions don't match
        targetCodeWatcher1.verifyAll();
        targetCodeWatcher2.verifyAll();
        serviceContainer.verifyAll();
    });
});
