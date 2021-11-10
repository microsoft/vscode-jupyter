// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import { anything, deepEqual, instance, mock, verify, when } from 'ts-mockito';
import { Memento, NotebookDocument, NotebookEditor, Uri } from 'vscode';
import { IApplicationShell, ICommandManager, IVSCodeNotebook } from '../../../../client/common/application/types';
import { IInstaller, InstallerResponse, Product } from '../../../../client/common/types';
import { Common, DataScience } from '../../../../client/common/utils/localize';
import { getResourceType } from '../../../../client/datascience/common';
import { KernelDependencyService } from '../../../../client/datascience/jupyter/kernels/kernelDependencyService';
import { IInteractiveWindow, IInteractiveWindowProvider } from '../../../../client/datascience/types';
import { IServiceContainer } from '../../../../client/ioc/types';
import { EnvironmentType } from '../../../../client/pythonEnvironments/info';
import { createPythonInterpreter } from '../../../utils/interpreters';

/* eslint-disable @typescript-eslint/no-explicit-any */

// eslint-disable-next-line
suite('DataScience - Kernel Dependency Service', () => {
    let dependencyService: KernelDependencyService;
    let notebooks: IVSCodeNotebook;
    let appShell: IApplicationShell;
    let cmdManager: ICommandManager;
    let installer: IInstaller;
    let serviceContainer: IServiceContainer;
    let memento: Memento;
    let editor: NotebookEditor;

    const interpreter = createPythonInterpreter({ displayName: 'name', envType: EnvironmentType.Conda, path: 'abc' });
    setup(() => {
        appShell = mock<IApplicationShell>();
        installer = mock<IInstaller>();
        cmdManager = mock<ICommandManager>();
        serviceContainer = mock<IServiceContainer>();
        memento = mock<Memento>();
        notebooks = mock<IVSCodeNotebook>();
        when(memento.get(anything(), anything())).thenReturn(false);
        when(cmdManager.executeCommand('notebook.selectKernel', anything())).thenResolve();
        when(notebooks.notebookDocuments).thenReturn([]);
        dependencyService = new KernelDependencyService(
            instance(appShell),
            instance(installer),
            instance(memento),
            false,
            instance(cmdManager),
            instance(notebooks),
            instance(serviceContainer)
        );
    });
    [undefined, Uri.file('test.py'), Uri.file('test.ipynb')].forEach((resource) => {
        suite(`With resource = ${resource?.toString()}`, () => {
            setup(() => {
                const document = mock<NotebookDocument>();
                editor = mock<NotebookEditor>();
                const interactiveWindowProvider = mock<IInteractiveWindowProvider>();
                const activeInteractiveWindow = mock<IInteractiveWindow>();
                if (resource && getResourceType(resource) === 'notebook') {
                    when(document.uri).thenReturn(resource);
                    when(notebooks.activeNotebookEditor).thenReturn(instance(editor));
                    when(notebooks.notebookDocuments).thenReturn([instance(document)]);
                } else {
                    when(activeInteractiveWindow.notebookEditor).thenReturn(instance(editor));
                    when(interactiveWindowProvider.activeWindow).thenReturn(instance(activeInteractiveWindow));
                    when(serviceContainer.get<IInteractiveWindowProvider>(IInteractiveWindowProvider)).thenReturn(
                        instance(interactiveWindowProvider)
                    );
                }
                when(editor.document).thenReturn(instance(document));
            });
            test('Check if ipykernel is installed', async () => {
                when(installer.isInstalled(Product.ipykernel, interpreter)).thenResolve(true);

                await dependencyService.installMissingDependencies(resource, interpreter);

                verify(installer.isInstalled(Product.ipykernel, interpreter)).once();
                verify(installer.isInstalled(anything(), anything())).once();
            });
            test('Do not prompt if if ipykernel is installed', async () => {
                when(installer.isInstalled(Product.ipykernel, interpreter)).thenResolve(true);

                await dependencyService.installMissingDependencies(resource, interpreter);

                verify(appShell.showErrorMessage(anything(), anything(), anything())).never();
            });
            test('Prompt if if ipykernel is not installed', async () => {
                when(installer.isInstalled(Product.ipykernel, interpreter)).thenResolve(false);
                when(appShell.showErrorMessage(anything(), anything())).thenResolve(Common.install() as any);

                await assert.isRejected(
                    dependencyService.installMissingDependencies(Uri.file('one.ipynb'), interpreter),
                    'IPyKernel not installed into interpreter'
                );

                verify(appShell.showErrorMessage(anything(), anything(), anything())).never();
            });
            test('Install ipykernel', async () => {
                when(installer.isInstalled(Product.ipykernel, interpreter)).thenResolve(false);
                when(installer.install(Product.ipykernel, interpreter, anything(), anything(), anything())).thenResolve(
                    InstallerResponse.Installed
                );
                when(appShell.showErrorMessage(anything(), anything(), anything())).thenResolve(
                    Common.install() as any
                );
                when(appShell.showErrorMessage(anything(), anything(), anything(), anything())).thenResolve(
                    Common.install() as any
                );

                await dependencyService.installMissingDependencies(resource, interpreter);
            });
            test('Install ipykernel second time should result in a re-install', async () => {
                when(memento.get(anything(), anything())).thenReturn(true);
                when(installer.isInstalled(Product.ipykernel, interpreter)).thenResolve(false);
                when(installer.install(Product.ipykernel, interpreter, anything(), true, anything())).thenResolve(
                    InstallerResponse.Installed
                );
                when(appShell.showErrorMessage(anything(), anything(), Common.reInstall())).thenResolve(
                    Common.reInstall() as any
                );
                when(appShell.showErrorMessage(anything(), anything(), Common.reInstall(), anything())).thenResolve(
                    Common.reInstall() as any
                );

                await dependencyService.installMissingDependencies(resource, interpreter);
            });
            test('Bubble installation errors', async () => {
                when(installer.isInstalled(Product.ipykernel, interpreter)).thenResolve(false);
                when(installer.install(Product.ipykernel, interpreter, anything(), anything(), anything())).thenReject(
                    new Error('Install failed - kaboom')
                );
                when(appShell.showErrorMessage(anything(), anything(), anything())).thenResolve(
                    Common.install() as any
                );
                when(appShell.showErrorMessage(anything(), anything(), anything(), anything())).thenResolve(
                    Common.install() as any
                );

                const promise = dependencyService.installMissingDependencies(resource, interpreter);

                await assert.isRejected(promise, 'Install failed - kaboom');
            });
            test('Select kernel instead of installing', async function () {
                if (resource === undefined) {
                    return this.skip();
                }

                when(memento.get(anything(), anything())).thenReturn(false);
                when(installer.isInstalled(Product.ipykernel, interpreter)).thenResolve(false);
                when(appShell.showErrorMessage(anything(), anything(), anything(), anything())).thenResolve(
                    DataScience.selectKernel() as any
                );

                const promise = dependencyService.installMissingDependencies(resource, interpreter);

                await assert.isRejected(promise, 'IPyKernel not installed into interpreter name:abc');

                verify(
                    cmdManager.executeCommand('notebook.selectKernel', deepEqual({ notebookEditor: instance(editor) }))
                ).once();
            });
            test('Throw an error if cancelling the prompt', async function () {
                if (resource === undefined) {
                    return this.skip();
                }

                when(memento.get(anything(), anything())).thenReturn(false);
                when(installer.isInstalled(Product.ipykernel, interpreter)).thenResolve(false);
                when(appShell.showErrorMessage(anything(), anything(), anything(), anything())).thenResolve();

                const promise = dependencyService.installMissingDependencies(resource, interpreter);

                await assert.isRejected(promise, 'IPyKernel not installed into interpreter name:abc');
                verify(cmdManager.executeCommand('notebook.selectKernel', anything())).never();
            });
        });
    });
});
