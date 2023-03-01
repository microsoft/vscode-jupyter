// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { anything, instance, mock, reset, verify, when } from 'ts-mockito';
import { EventEmitter, NotebookDocument, Uri } from 'vscode';
import {
    ICodeGeneratorFactory,
    IGeneratedCodeStorageFactory,
    IGeneratedCodeStore,
    IInteractiveWindowCodeGenerator
} from './editor-integration/types';
import { GeneratedCodeStorageManager } from './generatedCodeStoreManager';
import { IKernel, IKernelProvider } from '../kernels/types';
import { IControllerRegistration, IVSCodeNotebookController } from '../notebooks/controllers/types';
import { InteractiveWindowView } from '../platform/common/constants';
import { disposeAllDisposables } from '../platform/common/helpers';
import { IDisposable } from '../platform/common/types';
import { mockedVSCodeNamespaces } from '../test/vscode-mock';

suite('GeneratedCodeStorageManager', () => {
    const disposables: IDisposable[] = [];
    let storageManager: GeneratedCodeStorageManager;
    let kernelProvider: IKernelProvider;
    let storageFactory: IGeneratedCodeStorageFactory;
    let codeGeneratorFactory: ICodeGeneratorFactory;
    let controllers: IControllerRegistration;
    let onDidCreateKernel: EventEmitter<IKernel>;
    let onNotebookControllerSelected: EventEmitter<{
        notebook: NotebookDocument;
        controller: IVSCodeNotebookController;
    }>;
    setup(() => {
        onDidCreateKernel = new EventEmitter<IKernel>();
        onNotebookControllerSelected = new EventEmitter<{
            notebook: NotebookDocument;
            controller: IVSCodeNotebookController;
        }>();
        disposables.push(onDidCreateKernel);
        disposables.push(onNotebookControllerSelected);
        kernelProvider = mock<IKernelProvider>();
        storageFactory = mock<IGeneratedCodeStorageFactory>();
        codeGeneratorFactory = mock<ICodeGeneratorFactory>();
        controllers = mock<IControllerRegistration>();
        when(kernelProvider.onDidCreateKernel).thenReturn(onDidCreateKernel.event);
        when(controllers.onControllerSelected).thenReturn(onNotebookControllerSelected.event);
        storageManager = new GeneratedCodeStorageManager(
            instance(kernelProvider),
            disposables,
            instance(codeGeneratorFactory),
            instance(storageFactory),
            instance(controllers)
        );
        storageManager.activate();
    });
    teardown(() => {
        when(mockedVSCodeNamespaces.workspace.notebookDocuments).thenReturn([]);
        disposeAllDisposables(disposables);
    });

    test('Clear storage when notebook kernel changes', () => {
        const storage = mock<IGeneratedCodeStore>();
        const codeGenerator = mock<IInteractiveWindowCodeGenerator>();
        const notebook = instance(mock<NotebookDocument>());
        const randomNotebook = instance(mock<NotebookDocument>());
        when(storageFactory.get(anything())).thenCall((options: { notebook: NotebookDocument }) =>
            options.notebook === notebook ? instance(storage) : undefined
        );
        when(codeGeneratorFactory.get(notebook)).thenReturn(instance(codeGenerator));

        // Closing some random notebook will have no effect.
        onNotebookControllerSelected.fire({
            notebook: randomNotebook,
            controller: instance(mock<IVSCodeNotebookController>())
        });

        verify(storage.clear()).never();
        verify(codeGenerator.reset()).never();

        // Closing a specific notebook will result in clearing storage related to that notebook.
        onNotebookControllerSelected.fire({ notebook, controller: instance(mock<IVSCodeNotebookController>()) });

        verify(storage.clear()).once();
        verify(codeGenerator.reset()).once();
    });
    test('Clear storage when kernel is created', () => {
        const nbUri = Uri.file('hello.py');
        const storage = mock<IGeneratedCodeStore>();
        const codeGenerator = mock<IInteractiveWindowCodeGenerator>();
        const iwNotebook = mock<NotebookDocument>();
        const iwNotebookInstance = instance(iwNotebook);
        const kernel = mock<IKernel>();
        const iwKernelRestart = new EventEmitter<void>();
        disposables.push(iwKernelRestart);
        when(kernel.onRestarted).thenReturn(iwKernelRestart.event);
        when(kernel.notebook).thenReturn(iwNotebookInstance);
        when(kernel.uri).thenReturn(nbUri);
        when(kernel.creator).thenReturn('jupyterExtension');
        when(iwNotebook.notebookType).thenReturn(InteractiveWindowView);
        when(iwNotebook.uri).thenReturn(nbUri);
        const ipynbNotebook = mock<NotebookDocument>();
        const ipynbUri = Uri.file('random.ipynb');
        when(ipynbNotebook.uri).thenReturn(ipynbUri);
        when(mockedVSCodeNamespaces.workspace.notebookDocuments).thenReturn([
            iwNotebookInstance,
            instance(ipynbNotebook)
        ]);
        when(storageFactory.get(anything())).thenCall((options: { notebook: NotebookDocument }) =>
            options.notebook === iwNotebookInstance ? instance(storage) : undefined
        );
        when(codeGeneratorFactory.getOrCreate(iwNotebookInstance)).thenReturn(instance(codeGenerator));

        // Creating some random kernel will have no effect.
        onDidCreateKernel.fire(instance(mock<IKernel>()));
        verify(storage.clear()).never();
        verify(codeGenerator.reset()).never();

        // Creating some kernel for a ipynb notebook will have no effect.
        const nbKernel = mock<IKernel>();
        when(nbKernel.uri).thenReturn(ipynbUri);
        onDidCreateKernel.fire(instance(nbKernel));
        verify(storage.clear()).never();
        verify(codeGenerator.reset()).never();

        // Restarting an ipynb kernel, will not result in any changes to the storage.
        const nbKernelRestart = new EventEmitter<void>();
        disposables.push(nbKernelRestart);
        when(nbKernel.onRestarted).thenReturn(nbKernelRestart.event);
        nbKernelRestart.fire();
        verify(storage.clear()).never();
        verify(codeGenerator.reset()).never();

        // Creating a kernel for an IW will result in clearing storage related to that notebook.
        onDidCreateKernel.fire(instance(kernel));
        verify(storage.clear()).once();

        // Restarting the iw kernel will result in clearing storage related to that notebook.
        reset(storage);
        iwKernelRestart.fire();
        verify(storage.clear()).once();
        verify(codeGenerator.reset()).once();
    });
});
