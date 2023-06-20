// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable no-void */
/* eslint-disable @typescript-eslint/no-explicit-any */

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import * as fakeTimers from '@sinonjs/fake-timers';
import { NotebookDocument, EventEmitter, NotebookController, Uri, Disposable } from 'vscode';
import { VSCodeNotebookController } from './vscodeNotebookController';
import { IKernel, IKernelProvider, KernelConnectionMetadata, LocalKernelConnectionMetadata } from '../../kernels/types';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import {
    IApplicationShell,
    ICommandManager,
    IDocumentManager,
    IVSCodeNotebook,
    IWorkspaceService
} from '../../platform/common/application/types';
import {
    IBrowserService,
    IConfigurationService,
    IDisposable,
    IExtensionContext,
    IWatchableJupyterSettings
} from '../../platform/common/types';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { NotebookCellLanguageService } from '../languages/cellLanguageService';
import { IServiceContainer } from '../../platform/ioc/types';
import { IJupyterServerUriStorage } from '../../kernels/jupyter/types';
import { IPlatformService } from '../../platform/common/platform/types';
import { IPythonExtensionChecker } from '../../platform/api/types';
import { PYTHON_LANGUAGE } from '../../platform/common/constants';
import { TestNotebookDocument } from '../../test/datascience/notebook/executionHelper';
import { KernelConnector } from './kernelConnector';
import { ITrustedKernelPaths } from '../../kernels/raw/finder/types';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import { PythonEnvironment } from '../../platform/pythonEnvironments/info';
import { IConnectionDisplayDataProvider } from './types';
import { ConnectionDisplayDataProvider } from './connectionDisplayData.node';

suite(`Notebook Controller`, function () {
    let controller: NotebookController;
    let kernelConnection: KernelConnectionMetadata;
    let vscNotebookApi: IVSCodeNotebook;
    let commandManager: ICommandManager;
    let context: IExtensionContext;
    let languageService: NotebookCellLanguageService;
    let workspace: IWorkspaceService;
    let documentManager: IDocumentManager;
    let configService: IConfigurationService;
    let appShell: IApplicationShell;
    let browser: IBrowserService;
    let serviceContainer: IServiceContainer;
    let jupyterUriStorage: IJupyterServerUriStorage;
    let platform: IPlatformService;
    let kernelProvider: IKernelProvider;
    let extensionChecker: IPythonExtensionChecker;
    const disposables: IDisposable[] = [];
    let onDidChangeSelectedNotebooks: EventEmitter<{
        readonly notebook: NotebookDocument;
        readonly selected: boolean;
    }>;
    let kernel: IKernel;
    let onDidCloseNotebookDocument: EventEmitter<NotebookDocument>;
    let notebook: TestNotebookDocument;
    let clock: fakeTimers.InstalledClock;
    let jupyterSettings: IWatchableJupyterSettings;
    let trustedPaths: ITrustedKernelPaths;
    let displayDataProvider: IConnectionDisplayDataProvider;
    let interpreterService: IInterpreterService;
    setup(async function () {
        kernelConnection = mock<KernelConnectionMetadata>();
        vscNotebookApi = mock<IVSCodeNotebook>();
        commandManager = mock<ICommandManager>();
        context = mock<IExtensionContext>();
        languageService = mock<NotebookCellLanguageService>();
        workspace = mock<IWorkspaceService>();
        documentManager = mock<IDocumentManager>();
        configService = mock<IConfigurationService>();
        appShell = mock<IApplicationShell>();
        browser = mock<IBrowserService>();
        serviceContainer = mock<IServiceContainer>();
        jupyterUriStorage = mock<IJupyterServerUriStorage>();
        platform = mock<IPlatformService>();
        kernelProvider = mock<IKernelProvider>();
        extensionChecker = mock<IPythonExtensionChecker>();
        controller = mock<NotebookController>();
        kernel = mock<IKernel>();
        onDidChangeSelectedNotebooks = new EventEmitter<{
            readonly notebook: NotebookDocument;
            readonly selected: boolean;
        }>();
        jupyterSettings = mock<IWatchableJupyterSettings>();
        trustedPaths = mock<ITrustedKernelPaths>();
        interpreterService = mock<IInterpreterService>();
        const onDidChangeInterpreters = new EventEmitter<PythonEnvironment[]>();
        when(interpreterService.onDidChangeInterpreters).thenReturn(onDidChangeInterpreters.event);
        onDidCloseNotebookDocument = new EventEmitter<NotebookDocument>();
        disposables.push(onDidChangeSelectedNotebooks);
        disposables.push(onDidChangeInterpreters);
        disposables.push(onDidCloseNotebookDocument);
        clock = fakeTimers.install();
        disposables.push(new Disposable(() => clock.uninstall()));
        when(context.extensionUri).thenReturn(Uri.file('extension'));
        when(controller.onDidChangeSelectedNotebooks).thenReturn(onDidChangeSelectedNotebooks.event);
        when(vscNotebookApi.onDidCloseNotebookDocument).thenReturn(onDidCloseNotebookDocument.event);
        when(
            vscNotebookApi.createNotebookController(
                anything(),
                anything(),
                anything(),
                anything(),
                anything(),
                anything()
            )
        ).thenCall((_id, _view, _label, _handler) => {
            // executionHandler = handler;
            return instance(controller);
        });
        when(languageService.getSupportedLanguages(anything())).thenReturn([PYTHON_LANGUAGE]);
        when(workspace.isTrusted).thenReturn(true);
        when(vscNotebookApi.notebookEditors).thenReturn([]);
        when(documentManager.applyEdit(anything())).thenResolve();
        when(kernelProvider.getOrCreate(anything(), anything())).thenReturn(instance(kernel));
        when(configService.getSettings(anything())).thenReturn(instance(jupyterSettings));
        when((kernelConnection as LocalKernelConnectionMetadata).kernelSpec).thenReturn({
            argv: [],
            executable: '',
            name: '',
            display_name: '',
            specFile: '1'
        });
        when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);
        when(kernel.kernelConnectionMetadata).thenReturn(instance(kernelConnection));
        when(kernelConnection.id).thenReturn('1');
        when(serviceContainer.get<ITrustedKernelPaths>(ITrustedKernelPaths)).thenReturn(instance(trustedPaths));
        when(trustedPaths.isTrusted(anything())).thenReturn(true);
        when(jupyterSettings.disableJupyterAutoStart).thenReturn(false);
        displayDataProvider = new ConnectionDisplayDataProvider(
            instance(workspace),
            instance(platform),
            instance(jupyterUriStorage),
            disposables,
            instance(interpreterService)
        );
    });
    teardown(() => disposeAllDisposables(disposables));
    function createController(viewType: 'jupyter-notebook' | 'interactive') {
        new VSCodeNotebookController(
            instance(kernelConnection),
            '1',
            viewType,
            instance(vscNotebookApi),
            instance(commandManager),
            instance(kernelProvider),
            instance(context),
            disposables,
            instance(languageService),
            instance(workspace),
            instance(configService),
            instance(documentManager),
            instance(appShell),
            instance(browser),
            instance(extensionChecker),
            instance(serviceContainer),
            displayDataProvider
        );
        notebook = new TestNotebookDocument(undefined, viewType);
    }
    test('Kernel is created upon selecting a controller', async function () {
        createController('jupyter-notebook');
        when(kernelProvider.get(notebook)).thenReturn();

        onDidChangeSelectedNotebooks.fire({ notebook, selected: true });
        await clock.runAllAsync();

        verify(kernelProvider.getOrCreate(anything(), anything())).once();
    });
    test('Kernel is not created upon selecting a controller if workspace is not trusted', async function () {
        createController('jupyter-notebook');
        when(kernelProvider.get(notebook)).thenReturn();
        when(workspace.isTrusted).thenReturn(false);

        onDidChangeSelectedNotebooks.fire({ notebook, selected: true });
        await clock.runAllAsync();

        verify(kernelProvider.getOrCreate(anything(), anything())).never();
    });
    test('Kernel is auto started upon selecting a local controller', async function () {
        createController('jupyter-notebook');
        when(kernelConnection.kind).thenReturn('startUsingLocalKernelSpec');
        when(kernelProvider.get(notebook)).thenReturn();

        const oldConnectToNotebook = KernelConnector.connectToNotebookKernel;
        let kernelStarted = false;
        KernelConnector.connectToNotebookKernel = async () => {
            kernelStarted = true;
            return instance(kernel);
        };
        disposables.push(new Disposable(() => (KernelConnector.connectToNotebookKernel = oldConnectToNotebook)));
        onDidChangeSelectedNotebooks.fire({ notebook, selected: true });
        await clock.runAllAsync();

        verify(kernelProvider.getOrCreate(anything(), anything())).once();
        assert.isTrue(kernelStarted, 'Kernel not started');
    });
    test('Kernel is not auto started upon selecting a local controller if kernel path is not trusted', async function () {
        createController('jupyter-notebook');
        when(kernelConnection.kind).thenReturn('startUsingLocalKernelSpec');
        when(kernelProvider.get(notebook)).thenReturn();
        when(trustedPaths.isTrusted(anything())).thenReturn(false);

        const oldConnectToNotebook = KernelConnector.connectToNotebookKernel;
        let kernelStarted = false;
        KernelConnector.connectToNotebookKernel = async () => {
            kernelStarted = true;
            return instance(kernel);
        };
        disposables.push(new Disposable(() => (KernelConnector.connectToNotebookKernel = oldConnectToNotebook)));
        onDidChangeSelectedNotebooks.fire({ notebook, selected: true });
        await clock.runAllAsync();

        verify(kernelProvider.getOrCreate(anything(), anything())).once();
        assert.isFalse(kernelStarted, 'Kernel should not have been started');
    });
    test('Kernel is not auto started upon selecting a local controller if auto start is disabled', async function () {
        createController('jupyter-notebook');
        when(kernelConnection.kind).thenReturn('startUsingLocalKernelSpec');
        when(kernelProvider.get(notebook)).thenReturn();
        when(jupyterSettings.disableJupyterAutoStart).thenReturn(true);

        const oldConnectToNotebook = KernelConnector.connectToNotebookKernel;
        let kernelStarted = false;
        KernelConnector.connectToNotebookKernel = async () => {
            kernelStarted = true;
            return instance(kernel);
        };
        disposables.push(new Disposable(() => (KernelConnector.connectToNotebookKernel = oldConnectToNotebook)));
        onDidChangeSelectedNotebooks.fire({ notebook, selected: true });
        await clock.runAllAsync();

        verify(kernelProvider.getOrCreate(anything(), anything())).once();
        assert.isFalse(kernelStarted, 'Kernel should not have been started');
    });
    test('Kernel is not auto started upon selecting a remote kernelspec controller', async function () {
        createController('jupyter-notebook');
        when(kernelConnection.kind).thenReturn('startUsingRemoteKernelSpec');
        when(kernelProvider.get(notebook)).thenReturn();

        const oldConnectToNotebook = KernelConnector.connectToNotebookKernel;
        let kernelStarted = false;
        KernelConnector.connectToNotebookKernel = async () => {
            kernelStarted = true;
            return instance(kernel);
        };
        disposables.push(new Disposable(() => (KernelConnector.connectToNotebookKernel = oldConnectToNotebook)));
        onDidChangeSelectedNotebooks.fire({ notebook, selected: true });
        await clock.runAllAsync();

        verify(kernelProvider.getOrCreate(anything(), anything())).once();
        assert.isFalse(kernelStarted, 'Kernel should not have been started');
    });
    test('Kernel is not auto started upon selecting a remote live kernel controller', async function () {
        createController('jupyter-notebook');
        when(kernelConnection.kind).thenReturn('connectToLiveRemoteKernel');
        when(kernelProvider.get(notebook)).thenReturn();

        const oldConnectToNotebook = KernelConnector.connectToNotebookKernel;
        let kernelStarted = false;
        KernelConnector.connectToNotebookKernel = async () => {
            kernelStarted = true;
            return instance(kernel);
        };
        disposables.push(new Disposable(() => (KernelConnector.connectToNotebookKernel = oldConnectToNotebook)));
        onDidChangeSelectedNotebooks.fire({ notebook, selected: true });
        await clock.runAllAsync();

        verify(kernelProvider.getOrCreate(anything(), anything())).once();
        assert.isFalse(kernelStarted, 'Kernel should not have been started');
    });
    test('Update notebook metadata upon selecting a controller', async function () {
        createController('jupyter-notebook');
        when(kernelConnection.kind).thenReturn('connectToLiveRemoteKernel');
        when(kernelProvider.get(notebook)).thenReturn();
        when(jupyterSettings.disableJupyterAutoStart).thenReturn(true);

        onDidChangeSelectedNotebooks.fire({ notebook, selected: true });
        await clock.runAllAsync();

        verify(documentManager.applyEdit(anything())).once();
    });
});
