// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { INotebookMetadata } from '@jupyterlab/nbformat';
import { assert } from 'chai';
import { anything, instance, mock, when } from 'ts-mockito';
import { EventEmitter, NotebookControllerAffinity, NotebookDocument, Uri } from 'vscode';
import { IJupyterServerUriStorage } from '../../../../kernels/jupyter/types';
import {
    KernelConnectionMetadata,
    LocalKernelSpecConnectionMetadata,
    PythonKernelConnectionMetadata
} from '../../../../kernels/types';
import { ControllerPreferredService } from '../../../../notebooks/controllers/controllerPreferredService';
import {
    IControllerDefaultService,
    IControllerRegistration,
    IKernelRankingHelper,
    IVSCodeNotebookController
} from '../../../../notebooks/controllers/types';
import { IPythonExtensionChecker } from '../../../../platform/api/types';
import { IVSCodeNotebook } from '../../../../platform/common/application/types';
import { JupyterNotebookView, InteractiveWindowView, PYTHON_LANGUAGE } from '../../../../platform/common/constants';
import { disposeAllDisposables } from '../../../../platform/common/helpers';
import { IDisposable } from '../../../../platform/common/types';
import { IInterpreterService } from '../../../../platform/interpreter/contracts';

suite('Preferred Controller', () => {
    const disposables: IDisposable[] = [];
    let kernelRankHelper: IKernelRankingHelper;
    let preferredControllerService: ControllerPreferredService;
    let controllerRegistrations: IControllerRegistration;
    let vscNotebook: IVSCodeNotebook;
    let extensionChecker: IPythonExtensionChecker;
    let uriStorage: IJupyterServerUriStorage;
    let defaultControllerService: IControllerDefaultService;
    let interpreters: IInterpreterService;
    setup(() => {
        controllerRegistrations = mock<IControllerRegistration>();
        vscNotebook = mock<IVSCodeNotebook>();
        extensionChecker = mock<IPythonExtensionChecker>();
        uriStorage = mock<IJupyterServerUriStorage>();
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
        when(controllerRegistrations.getSelected(anything())).thenReturn(undefined);
        when(interpreters.refreshInterpreters()).thenResolve();
        preferredControllerService = new ControllerPreferredService(
            instance(controllerRegistrations),
            instance(defaultControllerService),
            instance(interpreters),
            instance(vscNotebook),
            instance(extensionChecker),
            instance(uriStorage),
            instance(kernelRankHelper),
            false
        );
        disposables.push(preferredControllerService);
    });
    teardown(() => {
        disposeAllDisposables(disposables);
    });

    const pythonKernel = PythonKernelConnectionMetadata.create({
        id: 'python',
        interpreter: {
            sysPrefix: '/usr/local/bin/python',
            uri: Uri.file('/usr/local/bin/python'),
            id: Uri.file('/usr/local/bin/python').fsPath,
            displayName: 'Python 3'
        },
        kernelSpec: {
            argv: ['python', '-m', 'ipykernel_launcher'],
            display_name: 'Python 3',
            executable: '/usr/local/bin/python',
            language: 'python',
            name: 'python3'
        }
    });
    const pythonKernelSpec = LocalKernelSpecConnectionMetadata.create({
        id: 'pythonKernelSpec',
        interpreter: {
            sysPrefix: '/usr/local/bin/python',
            uri: Uri.file('/usr/local/bin/python'),
            id: Uri.file('/usr/local/bin/python').fsPath,
            displayName: 'Python 3'
        },
        kernelSpec: {
            argv: ['python', '-m', 'ipykernel_launcher'],
            display_name: 'Python 3 KernelSpec',
            executable: '/usr/local/bin/python',
            language: 'python',
            name: 'python3'
        }
    });
    const juliaKernel = LocalKernelSpecConnectionMetadata.create({
        id: 'julia',
        kernelSpec: {
            argv: ['julia'],
            display_name: 'Julia',
            executable: '/usr/local/bin/julia',
            name: 'julia',
            language: 'julia'
        }
    });
    function createDocument(
        metadata: Partial<INotebookMetadata>,
        notebookType: typeof JupyterNotebookView | typeof InteractiveWindowView = JupyterNotebookView
    ) {
        const document = mock<NotebookDocument>();
        const uri = notebookType === JupyterNotebookView ? Uri.file('one.ipynb') : Uri.file('one.py');
        when(document.uri).thenReturn(uri);
        when(document.notebookType).thenReturn(notebookType);
        when(document.metadata).thenReturn({ custom: { metadata } });

        return document;
    }
    function setupData(kernels: KernelConnectionMetadata[]) {
        when(uriStorage.isLocalLaunch).thenReturn(true);
        when(
            kernelRankHelper.rankKernels(anything(), anything(), anything(), anything(), anything(), anything())
        ).thenResolve(kernels);
        when(kernelRankHelper.isExactMatch(anything(), anything(), anything())).thenResolve(false);
        when(controllerRegistrations.all).thenReturn(kernels);
        const controllers = kernels.map(createController);
        when(controllerRegistrations.registered).thenReturn(controllers.map(instance));
        return controllers;
    }
    function createController(kernel: KernelConnectionMetadata) {
        const controller = mock<IVSCodeNotebookController>();
        when(controller.id).thenReturn(kernel.id);
        when(controller.connection).thenReturn(kernel);
        when(controller.controller).thenReturn({ updateNotebookAffinity: () => Promise.resolve() } as any);
        when(controllerRegistrations.get(kernel, anything())).thenReturn(instance(controller));
        return controller;
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
        const document = createDocument(metadata);
        setupData(kernels);

        const { preferredConnection, controller } = await preferredControllerService.computePreferred(
            instance(document)
        );

        assert.isOk(preferredConnection);
        assert.equal(preferredConnection, juliaKernel);
        assert.equal(controller?.connection, juliaKernel);
    });
    test('No matching python Kernel when there are no python kernels', async () => {
        const kernels = [juliaKernel];
        const metadata: Partial<INotebookMetadata> = {
            kernelspec: {
                display_name: '',
                name: PYTHON_LANGUAGE
            },
            language_info: {
                name: PYTHON_LANGUAGE
            }
        };
        const document = createDocument(metadata);
        setupData(kernels);

        const { preferredConnection, controller } = await preferredControllerService.computePreferred(
            instance(document)
        );

        assert.isUndefined(preferredConnection);
        assert.isUndefined(controller);
    });
    test('No matching Julia Kernel when there are no Julia kernels', async () => {
        const kernels = [pythonKernel];
        const metadata: Partial<INotebookMetadata> = {
            kernelspec: {
                display_name: '',
                name: 'julia'
            },
            language_info: {
                name: 'julia'
            }
        };
        const document = createDocument(metadata);
        setupData(kernels);

        const { preferredConnection, controller } = await preferredControllerService.computePreferred(
            instance(document)
        );

        assert.isUndefined(preferredConnection);
        assert.isUndefined(controller);
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

        const document = createDocument(metadata);
        setupData(kernels);

        const { preferredConnection, controller } = await preferredControllerService.computePreferred(
            instance(document)
        );

        assert.isUndefined(preferredConnection);
        assert.isUndefined(controller);
    });
    test('Matches first available Python kernel, then matches another when we have more kernels', async () => {
        const kernels = [pythonKernel];
        const metadata: Partial<INotebookMetadata> = {
            kernelspec: {
                display_name: 'Python 3 KernelSpec',
                name: PYTHON_LANGUAGE
            },
            language_info: {
                name: PYTHON_LANGUAGE
            }
        };

        const document = createDocument(metadata);
        const oldControllers = setupData(kernels);
        let updatedAffinity: NotebookControllerAffinity | undefined;
        when(oldControllers[0].controller).thenReturn({
            updateNotebookAffinity: async (_: any, affinity: NotebookControllerAffinity) => {
                updatedAffinity = affinity;
                return;
            }
        } as any);
        const { preferredConnection, controller } = await preferredControllerService.computePreferred(
            instance(document)
        );

        assert.isOk(controller);
        assert.strictEqual(preferredConnection, pythonKernel);

        // Lets assume we have more kernels that we discovered later.
        const updatedKernels = [pythonKernel, pythonKernelSpec];
        when(
            kernelRankHelper.rankKernels(anything(), anything(), anything(), anything(), anything(), anything())
        ).thenResolve(updatedKernels);
        when(controllerRegistrations.all).thenReturn(updatedKernels);
        when(kernelRankHelper.isExactMatch(anything(), anything(), anything())).thenResolve(true);
        const kernelSpecController = createController(pythonKernelSpec);
        when(controllerRegistrations.registered).thenReturn([...oldControllers, kernelSpecController].map(instance));

        const { controller: newController, preferredConnection: newPreferredConnection } =
            await preferredControllerService.computePreferred(instance(document));

        assert.isOk(newController);
        assert.strictEqual(newPreferredConnection, pythonKernelSpec);
        // Verify the old controller was updated with default affinity.
        assert.strictEqual(updatedAffinity, NotebookControllerAffinity.Default);
    });
    test('Matches first available Python kernel, then matches none when we have more kernels', async () => {
        const kernels = [pythonKernel];
        const metadata: Partial<INotebookMetadata> = {
            kernelspec: {
                display_name: '',
                name: PYTHON_LANGUAGE
            },
            language_info: {
                name: PYTHON_LANGUAGE
            }
        };

        const document = createDocument(metadata);
        const oldControllers = setupData(kernels);
        let updatedAffinity: NotebookControllerAffinity | undefined;
        when(oldControllers[0].controller).thenReturn({
            updateNotebookAffinity: async (_: any, affinity: NotebookControllerAffinity) => {
                updatedAffinity = affinity;
                return;
            }
        } as any);
        const { preferredConnection, controller } = await preferredControllerService.computePreferred(
            instance(document)
        );

        assert.isOk(controller);
        assert.strictEqual(preferredConnection, pythonKernel);

        // Lets assume we have more kernels that we discovered later.
        const updatedKernels = [pythonKernel, pythonKernelSpec];
        when(
            kernelRankHelper.rankKernels(anything(), anything(), anything(), anything(), anything(), anything())
        ).thenResolve(updatedKernels);
        when(controllerRegistrations.all).thenReturn(updatedKernels);
        when(kernelRankHelper.isExactMatch(anything(), anything(), anything())).thenResolve(false);
        const kernelSpecController = createController(pythonKernelSpec);
        when(controllerRegistrations.registered).thenReturn([...oldControllers, kernelSpecController].map(instance));

        const { controller: newController, preferredConnection: newPreferredConnection } =
            await preferredControllerService.computePreferred(instance(document));

        assert.isUndefined(newController);
        assert.isUndefined(newPreferredConnection);
        // Verify the old controller was updated with default affinity.
        assert.strictEqual(updatedAffinity, NotebookControllerAffinity.Default);
    });
});
