// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { INotebookMetadata } from '@jupyterlab/nbformat';
import { assert } from 'chai';
import { anything, instance, mock, when } from 'ts-mockito';
import { EventEmitter, NotebookDocument, Uri } from 'vscode';
import { IServerConnectionType } from '../../../../kernels/jupyter/types';
import {
    KernelConnectionMetadata,
    LocalKernelConnectionMetadata,
    PythonKernelConnectionMetadata
} from '../../../../kernels/types';
import { ControllerPreferredService } from '../../../../notebooks/controllers/controllerPreferredService';
import {
    IControllerDefaultService,
    IControllerLoader,
    IControllerRegistration,
    IKernelRankingHelper,
    IVSCodeNotebookController
} from '../../../../notebooks/controllers/types';
import { IPythonExtensionChecker } from '../../../../platform/api/types';
import { IVSCodeNotebook } from '../../../../platform/common/application/types';
import { JupyterNotebookView, InteractiveWindowView } from '../../../../platform/common/constants';
import { disposeAllDisposables } from '../../../../platform/common/helpers';
import { IDisposable } from '../../../../platform/common/types';
import { IInterpreterService } from '../../../../platform/interpreter/contracts';

suite('Preferred Controller', () => {
    const disposables: IDisposable[] = [];
    let kernelRankHelper: IKernelRankingHelper;
    let preferredControllerService: ControllerPreferredService;
    let controllerRegistrations: IControllerRegistration;
    let controllerLoader: IControllerLoader;
    let vscNotebook: IVSCodeNotebook;
    let extensionChecker: IPythonExtensionChecker;
    let serverConnectionType: IServerConnectionType;
    let defaultControllerService: IControllerDefaultService;
    let interpreters: IInterpreterService;
    setup(() => {
        controllerRegistrations = mock<IControllerRegistration>();
        controllerLoader = mock<IControllerLoader>();
        vscNotebook = mock<IVSCodeNotebook>();
        extensionChecker = mock<IPythonExtensionChecker>();
        serverConnectionType = mock<IServerConnectionType>();
        defaultControllerService = mock<IControllerDefaultService>();
        interpreters = mock<IInterpreterService>();
        kernelRankHelper = mock<IKernelRankingHelper>();
        const onDidOpenNotebookDocument = new EventEmitter<NotebookDocument>();
        disposables.push(onDidOpenNotebookDocument);
        const onDidCloseNotebookDocument = new EventEmitter<NotebookDocument>();
        disposables.push(onDidCloseNotebookDocument);
        when(vscNotebook.onDidOpenNotebookDocument).thenReturn(onDidOpenNotebookDocument.event);
        when(vscNotebook.onDidCloseNotebookDocument).thenReturn(onDidCloseNotebookDocument.event);
        when(vscNotebook.notebookDocuments).thenReturn([]);
        preferredControllerService = new ControllerPreferredService(
            instance(controllerRegistrations),
            instance(controllerLoader),
            instance(defaultControllerService),
            instance(interpreters),
            instance(vscNotebook),
            disposables,
            instance(extensionChecker),
            instance(serverConnectionType),
            instance(kernelRankHelper)
        );
    });
    teardown(() => {
        disposeAllDisposables(disposables);
    });

    const pythonKernel: PythonKernelConnectionMetadata = {
        id: 'python',
        interpreter: {
            sysPrefix: '/usr/local/bin/python',
            uri: Uri.file('/usr/local/bin/python'),
            displayName: 'Python 3'
        },
        kernelSpec: {
            argv: ['python', '-m', 'ipykernel_launcher'],
            display_name: 'Python 3',
            executable: '/usr/local/bin/python',
            language: 'python',
            name: 'python3'
        },
        kind: 'startUsingPythonInterpreter'
    };
    const juliaKernel: LocalKernelConnectionMetadata = {
        id: 'julia',
        kernelSpec: {
            argv: ['julia'],
            display_name: 'Julia',
            executable: '/usr/local/bin/julia',
            name: 'julia',
            language: 'julia'
        },
        kind: 'startUsingLocalKernelSpec'
    };
    function setupData(
        metadata: Partial<INotebookMetadata>,
        kernels: KernelConnectionMetadata[],
        notebookType: typeof JupyterNotebookView | typeof InteractiveWindowView = JupyterNotebookView
    ) {
        const document = mock<NotebookDocument>();
        const uri = notebookType === JupyterNotebookView ? Uri.file('one.ipynb') : Uri.file('one.py');
        when(document.uri).thenReturn(uri);
        when(document.notebookType).thenReturn(notebookType);
        when(document.metadata).thenReturn({ custom: { metadata } });
        when(serverConnectionType.isLocalLaunch).thenReturn(true);
        when(
            kernelRankHelper.rankKernels(anything(), anything(), anything(), anything(), anything(), anything())
        ).thenResolve(kernels);
        when(kernelRankHelper.isExactMatch(anything(), anything(), anything())).thenReturn(false);
        const controllers = kernels.map((kernel) => {
            const controller = mock<IVSCodeNotebookController>();
            when(controller.id).thenReturn(kernel.id);
            when(controller.connection).thenReturn(kernel);
            when(controller.controller).thenReturn({ updateNotebookAffinity: () => Promise.resolve() } as any);
            when(controllerRegistrations.get(kernel, anything())).thenReturn(instance(controller));
            return instance(controller);
        });
        when(controllerRegistrations.registered).thenReturn(controllers);

        return { document };
    }
    test('Find preferred non-python Kernel', async () => {
        const kernels = [pythonKernel, juliaKernel];
        const metadata: Partial<INotebookMetadata> = {
            kernelspec: {
                display_name: '',
                name: 'julia'
            },
            language_info: {
                name: 'julia'
            }
        };
        const { document } = setupData(metadata, kernels);

        const { preferredConnection, controller } = await preferredControllerService.computePreferred(
            instance(document)
        );

        assert.isOk(preferredConnection);
        assert.equal(preferredConnection, juliaKernel);
        assert.equal(controller?.connection, juliaKernel);
    });
    test('Does not find a matching Kernel', async () => {
        const kernels = [pythonKernel, juliaKernel];
        const metadata: Partial<INotebookMetadata> = {
            kernelspec: {
                display_name: '',
                name: 'java'
            },
            language_info: {
                name: 'java'
            }
        };

        const { document } = setupData(metadata, kernels);

        const { preferredConnection, controller } = await preferredControllerService.computePreferred(
            instance(document)
        );

        assert.isUndefined(preferredConnection);
        assert.isUndefined(controller);
    });
});
