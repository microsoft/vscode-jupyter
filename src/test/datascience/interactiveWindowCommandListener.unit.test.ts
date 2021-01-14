// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { nbformat } from '@jupyterlab/coreutils/lib/nbformat';
import { assert } from 'chai';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { Matcher } from 'ts-mockito/lib/matcher/type/Matcher';
import * as TypeMoq from 'typemoq';
import * as uuid from 'uuid/v4';
import { EventEmitter, Uri } from 'vscode';
import { ApplicationShell } from '../../client/common/application/applicationShell';
import { IApplicationShell } from '../../client/common/application/types';
import { ConfigurationService } from '../../client/common/configuration/service';
import { FileSystem } from '../../client/common/platform/fileSystem';
import { IFileSystem } from '../../client/common/platform/types';
import { IConfigurationService, IDisposable } from '../../client/common/types';
import * as localize from '../../client/common/utils/localize';
import { generateCells } from '../../client/datascience/cellFactory';
import { Commands } from '../../client/datascience/constants';
import { DataScienceErrorHandler } from '../../client/datascience/errorHandler/errorHandler';
import { ExportDialog } from '../../client/datascience/export/exportDialog';
import { ExportFormat, IExportDialog, IExportManager } from '../../client/datascience/export/types';
import { NotebookProvider } from '../../client/datascience/interactive-common/notebookProvider';
import { InteractiveWindowCommandListener } from '../../client/datascience/interactive-window/interactiveWindowCommandListener';
import { InteractiveWindowProvider } from '../../client/datascience/interactive-window/interactiveWindowProvider';
import { JupyterExecutionFactory } from '../../client/datascience/jupyter/jupyterExecutionFactory';
import { JupyterExporter } from '../../client/datascience/jupyter/jupyterExporter';
import { NativeEditorProvider } from '../../client/datascience/notebookStorage/nativeEditorProvider';
import {
    IInteractiveWindow,
    IJupyterExecution,
    INotebook,
    INotebookEditorProvider,
    INotebookServer
} from '../../client/datascience/types';
import { IInterpreterService } from '../../client/interpreter/contracts';
import { ServiceContainer } from '../../client/ioc/container';
import { MockCommandManager } from './mockCommandManager';
import { MockDocumentManager } from './mockDocumentManager';
import { MockJupyterSettings } from './mockJupyterSettings';
import { MockStatusProvider } from './mockStatusProvider';

/* eslint-disable @typescript-eslint/no-explicit-any, , no-multi-str,  */

function createTypeMoq<T>(tag: string): TypeMoq.IMock<T> {
    // Use typemoqs for those things that are resolved as promises. mockito doesn't allow nesting of mocks. ES6 Proxy class
    // is the problem. We still need to make it thenable though. See this issue: https://github.com/florinn/typemoq/issues/67
    const result = TypeMoq.Mock.ofType<T>();
    (result as any).tag = tag;
    result.setup((x: any) => x.then).returns(() => undefined);
    return result;
}

/* eslint-disable @typescript-eslint/no-explicit-any, , no-multi-str,  */
suite('Interactive window command listener', async () => {
    const interpreterService = mock<IInterpreterService>();
    const configService = mock(ConfigurationService);
    const fileSystem = mock(FileSystem);
    const serviceContainer = mock(ServiceContainer);
    const dummyEvent = new EventEmitter<void>();
    const pythonSettings = new MockJupyterSettings(undefined);
    const disposableRegistry: IDisposable[] = [];
    const interactiveWindowProvider = mock(InteractiveWindowProvider);
    const dataScienceErrorHandler = mock(DataScienceErrorHandler);
    const notebookExporter = mock(JupyterExporter);
    let applicationShell: IApplicationShell;
    let jupyterExecution: IJupyterExecution;
    const interactiveWindow = createTypeMoq<IInteractiveWindow>('Interactive Window');
    const documentManager = new MockDocumentManager();
    const statusProvider = new MockStatusProvider();
    const commandManager = new MockCommandManager();
    const exportManager = mock<IExportManager>();
    let notebookEditorProvider: INotebookEditorProvider;
    const server = createTypeMoq<INotebookServer>('jupyter server');
    let lastFileContents: any;
    let exportDialog: IExportDialog;

    teardown(() => {
        documentManager.activeTextEditor = undefined;
        lastFileContents = undefined;
    });

    class FunctionMatcher extends Matcher {
        private func: (obj: any) => boolean;
        constructor(func: (obj: any) => boolean) {
            super();
            this.func = func;
        }
        public match(value: Object): boolean {
            return this.func(value);
        }
        public toString(): string {
            return 'FunctionMatcher';
        }
    }

    function argThat(func: (obj: any) => boolean): any {
        return new FunctionMatcher(func);
    }

    function createCommandListener(): InteractiveWindowCommandListener {
        notebookEditorProvider = mock(NativeEditorProvider);
        jupyterExecution = mock(JupyterExecutionFactory);
        applicationShell = mock(ApplicationShell);
        exportDialog = mock(ExportDialog);

        // Setup defaults
        when(interpreterService.onDidChangeInterpreter).thenReturn(dummyEvent.event);
        when(interpreterService.getInterpreterDetails(argThat((o) => !o.includes || !o.includes('python')))).thenReject(
            ('Unknown interpreter' as any) as Error
        );

        // Service container needs logger, file system, and config service
        when(serviceContainer.get<IConfigurationService>(IConfigurationService)).thenReturn(instance(configService));
        when(serviceContainer.get<IFileSystem>(IFileSystem)).thenReturn(instance(fileSystem));
        when(configService.getSettings(anything())).thenReturn(pythonSettings);

        when(exportDialog.showDialog(anything(), anything())).thenReturn(Promise.resolve(Uri.file('foo')));

        // Setup default settings
        pythonSettings.assign({
            allowImportFromNotebook: true,
            alwaysTrustNotebooks: true,
            jupyterLaunchTimeout: 10,
            jupyterLaunchRetries: 3,
            jupyterServerType: 'local',
            changeDirOnImportExport: false,
            // eslint-disable-next-line no-template-curly-in-string
            notebookFileRoot: '${fileDirname}',
            useDefaultConfigForJupyter: true,
            jupyterInterruptTimeout: 10000,
            searchForJupyter: true,
            showCellInputCode: true,
            collapseCellInputCodeByDefault: true,
            allowInput: true,
            maxOutputSize: 400,
            enableScrollingForCellOutputs: true,
            errorBackgroundColor: '#FFFFFF',
            sendSelectionToInteractiveWindow: false,
            variableExplorerExclude: 'module;function;builtin_function_or_method',
            codeRegularExpression: '^(#\\s*%%|#\\s*\\<codecell\\>|#\\s*In\\[\\d*?\\]|#\\s*In\\[ \\])',
            markdownRegularExpression: '^(#\\s*%%\\s*\\[markdown\\]|#\\s*\\<markdowncell\\>)',
            enablePlotViewer: true,
            runStartupCommands: '',
            debugJustMyCode: true,
            variableQueries: [],
            jupyterCommandLineArguments: [],
            widgetScriptSources: [],
            interactiveWindowMode: 'single'
        });

        // We also need a file system
        const tempFile = {
            dispose: () => {
                return undefined;
            },
            filePath: '/foo/bar/baz.py'
        };
        when(fileSystem.createTemporaryLocalFile(anything())).thenResolve(tempFile);
        when(fileSystem.deleteLocalDirectory(anything())).thenResolve();
        when(
            fileSystem.writeFile(
                anything(),
                argThat((o) => {
                    lastFileContents = o;
                    return true;
                })
            )
        ).thenResolve();
        when(fileSystem.arePathsSame(anything(), anything())).thenReturn(true);

        when(interactiveWindowProvider.getOrCreate(anything())).thenResolve(interactiveWindow.object);
        const metadata: nbformat.INotebookMetadata = {
            language_info: {
                name: 'python',
                codemirror_mode: {
                    name: 'ipython',
                    version: 3
                }
            },
            orig_nbformat: 2,
            file_extension: '.py',
            mimetype: 'text/x-python',
            name: 'python',
            npconvert_exporter: 'python',
            pygments_lexer: `ipython${3}`,
            version: 3
        };
        when(notebookExporter.translateToNotebook(anything())).thenResolve({
            cells: [],
            nbformat: 4,
            nbformat_minor: 2,
            metadata: metadata
        });

        when(jupyterExecution.isNotebookSupported()).thenResolve(true);

        documentManager.addDocument('#%%\r\nprint("code")', 'bar.ipynb');

        when(applicationShell.showInformationMessage(anything(), anything())).thenReturn(Promise.resolve('moo'));
        when(applicationShell.showInformationMessage(anything())).thenReturn(Promise.resolve('moo'));

        const notebookProvider = mock(NotebookProvider);

        const result = new InteractiveWindowCommandListener(
            disposableRegistry,
            instance(interactiveWindowProvider),
            instance(notebookExporter),
            instance(jupyterExecution),
            instance(notebookProvider),
            documentManager,
            instance(applicationShell),
            instance(fileSystem),
            instance(configService),
            statusProvider,
            instance(dataScienceErrorHandler),
            instance(notebookEditorProvider),
            instance(exportManager),
            instance(exportDialog)
        );
        result.register(commandManager);

        return result;
    }

    test('Import', async () => {
        createCommandListener();
        when(applicationShell.showOpenDialog(argThat((o) => o.openLabel && o.openLabel.includes('Import')))).thenReturn(
            Promise.resolve([Uri.file('foo')])
        );
        await commandManager.executeCommand(Commands.ImportNotebook, undefined, undefined);
        verify(exportManager.export(ExportFormat.python, anything(), anything())).once();
    });
    test('Import File', async () => {
        createCommandListener();
        await commandManager.executeCommand(Commands.ImportNotebook, Uri.file('bar.ipynb'), undefined);
        verify(exportManager.export(ExportFormat.python, anything(), anything())).twice();
    });
    test('Export File', async () => {
        createCommandListener();
        const doc = await documentManager.openTextDocument('bar.ipynb');
        await documentManager.showTextDocument(doc);
        when(applicationShell.showInformationMessage(anything(), anything())).thenReturn(Promise.resolve('moo'));
        when(applicationShell.showInformationMessage(anything(), anything(), anything())).thenReturn(
            Promise.resolve('moo')
        );
        when(jupyterExecution.isSpawnSupported()).thenResolve(true);

        await commandManager.executeCommand(Commands.ExportFileAsNotebook, Uri.file('bar.ipynb'), undefined);

        assert.ok(lastFileContents, 'Export file was not written to');
        verify(
            applicationShell.showInformationMessage(
                anything(),
                localize.DataScience.exportOpenQuestion1(),
                localize.DataScience.exportOpenQuestion()
            )
        ).once();
    });
    test('Export File and output', async () => {
        createCommandListener();
        const doc = await documentManager.openTextDocument('bar.ipynb');
        await documentManager.showTextDocument(doc);
        when(jupyterExecution.connectToNotebookServer(anything(), anything())).thenResolve(server.object);
        const notebook = createTypeMoq<INotebook>('jupyter notebook');
        server
            .setup((s) => s.createNotebook(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(notebook.object));
        notebook
            .setup((n) =>
                n.execute(
                    TypeMoq.It.isAny(),
                    TypeMoq.It.isAny(),
                    TypeMoq.It.isAnyNumber(),
                    TypeMoq.It.isAny(),
                    TypeMoq.It.isAny()
                )
            )
            .returns(() => {
                return Promise.resolve(generateCells(undefined, 'a=1', 'bar.py', 0, false, uuid()));
            });

        when(applicationShell.showInformationMessage(anything(), anything())).thenReturn(Promise.resolve('moo'));
        when(applicationShell.showInformationMessage(anything(), anything(), anything())).thenReturn(
            Promise.resolve('moo')
        );
        when(jupyterExecution.isSpawnSupported()).thenResolve(true);

        await commandManager.executeCommand(Commands.ExportFileAndOutputAsNotebook, Uri.file('bar.ipynb'));

        assert.ok(lastFileContents, 'Export file was not written to');
        verify(
            applicationShell.showInformationMessage(
                anything(),
                localize.DataScience.exportOpenQuestion1(),
                localize.DataScience.exportOpenQuestion()
            )
        ).once();
    });
    test('Export skipped on no file', async () => {
        createCommandListener();
        await commandManager.executeCommand(Commands.ExportFileAndOutputAsNotebook, Uri.file('bar.ipynb'));
        assert.notExists(lastFileContents, 'Export file was written to');
    });
    test('Export happens on no file', async () => {
        createCommandListener();
        const doc = await documentManager.openTextDocument('bar.ipynb');
        await documentManager.showTextDocument(doc);
        await commandManager.executeCommand(Commands.ExportFileAsNotebook, undefined, undefined);
        assert.ok(lastFileContents, 'Export file was not written to');
    });
});
