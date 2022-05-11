/* eslint-disable @typescript-eslint/no-explicit-any */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { anything, instance, mock, verify, when } from 'ts-mockito';
import { EventEmitter, NotebookController, NotebookDocument, Uri } from 'vscode';
import {
    IApplicationShell,
    ICommandManager,
    IDocumentManager,
    IVSCodeNotebook,
    IWorkspaceService
} from '../../../platform/common/application/types';
import { IBrowserService, IConfigurationService, IDisposable, IExtensionContext } from '../../../platform/common/types';
import { IKernelProvider, KernelConnectionMetadata, LiveRemoteKernelConnectionMetadata } from '../../../kernels/types';
import { PreferredRemoteKernelIdProvider } from '../../../kernels/jupyter/preferredRemoteKernelIdProvider';
import { NotebookCellLanguageService } from '../../../intellisense/cellLanguageService';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { IServiceContainer } from '../../../platform/ioc/types';
import { LiveRemoteKernelConnectionUsageTracker } from '../../../kernels/jupyter/liveRemoteKernelConnectionTracker';
import { VSCodeNotebookController } from '../../../notebooks/controllers/vscodeNotebookController';
import { JupyterNotebookView } from '../../../notebooks/constants';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { computeServerId } from '../../../kernels/jupyter/jupyterUtils';

suite('Notebook Controller', () => {
    let notebookApi: IVSCodeNotebook;
    let commandManager: ICommandManager;
    let kernelProvider: IKernelProvider;
    let preferredRemoteKernelIdProvider: PreferredRemoteKernelIdProvider;
    let context: IExtensionContext;
    let languageServer: NotebookCellLanguageService;
    let workspace: IWorkspaceService;
    let configuration: IConfigurationService;
    let documentManager: IDocumentManager;
    let appShell: IApplicationShell;
    let browser: IBrowserService;
    let extensionChecker: IPythonExtensionChecker;
    let serviceContainer: IServiceContainer;
    let liveKernleConnectionTracker: LiveRemoteKernelConnectionUsageTracker;
    let controller: NotebookController;
    const disposables: IDisposable[] = [];
    const extensionUri = Uri.file('/home/extensions/jupyterextension');
    let onDidChangeSelectedNotebooks: EventEmitter<{ readonly notebook: NotebookDocument; readonly selected: boolean }>;
    const server2Uri = 'http://one:1234/hello?token=1234';
    const remoteLiveKernel2: LiveRemoteKernelConnectionMetadata = {
        baseUrl: 'http://one:1234/',
        id: 'connectionId2',
        kind: 'connectToLiveRemoteKernel',
        serverId: computeServerId(server2Uri),
        kernelModel: {
            id: 'modelId2',
            lastActivityTime: new Date(),
            model: {
                id: 'modelId2',
                kernel: {
                    id: 'kernelI2',
                    name: 'kernelName2'
                },
                name: 'modelName2',
                path: '',
                type: ''
            },
            name: '',
            numberOfConnections: 0
        }
    };

    setup(async () => {
        notebookApi = mock<IVSCodeNotebook>();
        commandManager = mock<ICommandManager>();
        kernelProvider = mock<IKernelProvider>();
        preferredRemoteKernelIdProvider = mock<PreferredRemoteKernelIdProvider>();
        context = mock<IExtensionContext>();
        languageServer = mock<NotebookCellLanguageService>();
        workspace = mock<IWorkspaceService>();
        configuration = mock<IConfigurationService>();
        documentManager = mock<IDocumentManager>();
        appShell = mock<IApplicationShell>();
        browser = mock<IBrowserService>();
        extensionChecker = mock<IPythonExtensionChecker>();
        serviceContainer = mock<IServiceContainer>();
        liveKernleConnectionTracker = mock<LiveRemoteKernelConnectionUsageTracker>();
        controller = mock<NotebookController>();
        onDidChangeSelectedNotebooks = new EventEmitter<{
            readonly notebook: NotebookDocument;
            readonly selected: boolean;
        }>();

        disposables.push(onDidChangeSelectedNotebooks);
        when(controller.onDidChangeSelectedNotebooks).thenReturn(onDidChangeSelectedNotebooks.event);
        when(
            notebookApi.createNotebookController(anything(), anything(), anything(), anything(), anything())
        ).thenReturn(instance(controller));
        when(context.extensionUri).thenReturn(extensionUri);
    });
    teardown(() => disposeAllDisposables(disposables));

    function createController(kernelConnection: KernelConnectionMetadata) {
        return new VSCodeNotebookController(
            kernelConnection,
            '1',
            JupyterNotebookView,
            'label',
            instance(notebookApi),
            instance(commandManager),
            instance(kernelProvider),
            instance(preferredRemoteKernelIdProvider),
            instance(context),
            disposables,
            instance(languageServer),
            instance(workspace),
            instance(configuration),
            instance(documentManager),
            instance(appShell),
            instance(browser),
            instance(extensionChecker),
            instance(serviceContainer),
            instance(liveKernleConnectionTracker)
        );
    }

    function createNotebook(uri: Uri) {
        const nb = mock<NotebookDocument>();
        when(nb.uri).thenReturn(uri);
        return nb;
    }
    test('Track live kernel as not being used anymore', async () => {
        when(kernelProvider.get(anything())).thenReturn(undefined);

        createController(remoteLiveKernel2);

        // Upon changing the kernel from a live kernel to something else,
        // ensure we mark this live kernel connection as not being used anymore.
        const notebook = createNotebook(Uri.file('a.ipynb'));

        onDidChangeSelectedNotebooks.fire({ notebook, selected: false });

        verify(
            liveKernleConnectionTracker.trackKernelIdAsNotUsed(
                remoteLiveKernel2.serverId,
                remoteLiveKernel2.kernelModel.id!,
                notebook
            )
        ).once();
    });
});
