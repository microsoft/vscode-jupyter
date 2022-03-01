// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { CancellationTokenSource, Memento, NotebookDocument, NotebookEditor, Uri } from 'vscode';
import { IApplicationShell, ICommandManager, IVSCodeNotebook } from '../../../../client/common/application/types';
import { IInstaller, InstallerResponse, Product } from '../../../../client/common/types';
import { Common, DataScience } from '../../../../client/common/utils/localize';
import { getResourceType } from '../../../../client/datascience/common';
import { DisplayOptions } from '../../../../client/datascience/displayOptions';
import { createInterpreterKernelSpec } from '../../../../client/datascience/jupyter/kernels/helpers';
import { KernelDependencyService } from '../../../../client/datascience/jupyter/kernels/kernelDependencyService';
import { IKernelProvider, PythonKernelConnectionMetadata } from '../../../../client/datascience/jupyter/kernels/types';
import {
    IInteractiveWindow,
    IInteractiveWindowProvider,
    IRawNotebookSupportedService,
    KernelInterpreterDependencyResponse
} from '../../../../client/datascience/types';
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
    let kernelProvider: IKernelProvider;
    let memento: Memento;
    let editor: NotebookEditor;

    const interpreter = createPythonInterpreter({ displayName: 'name', envType: EnvironmentType.Conda, path: 'abc' });
    const metadata: PythonKernelConnectionMetadata = {
        interpreter,
        kind: 'startUsingPythonInterpreter',
        kernelSpec: createInterpreterKernelSpec(interpreter, ''),
        id: '1'
    };
    setup(() => {
        appShell = mock<IApplicationShell>();
        installer = mock<IInstaller>();
        cmdManager = mock<ICommandManager>();
        serviceContainer = mock<IServiceContainer>();
        memento = mock<Memento>();
        kernelProvider = mock<IKernelProvider>();
        notebooks = mock<IVSCodeNotebook>();
        when(kernelProvider.kernels).thenReturn([]);
        when(kernelProvider.get(anything())).thenReturn();
        when(memento.get(anything(), anything())).thenReturn(false);
        when(serviceContainer.get<IKernelProvider>(IKernelProvider)).thenReturn(instance(kernelProvider));
        when(cmdManager.executeCommand('notebook.selectKernel', anything())).thenResolve();
        when(notebooks.notebookDocuments).thenReturn([]);
        const rawSupport = mock<IRawNotebookSupportedService>();
        when(rawSupport.isSupported).thenReturn(true);
        dependencyService = new KernelDependencyService(
            instance(appShell),
            instance(installer),
            instance(memento),
            false,
            instance(rawSupport),
            instance(serviceContainer)
        );
    });
    [undefined, Uri.file('test.py'), Uri.file('test.ipynb')].forEach((resource) => {
        suite(`With resource = ${resource?.toString()}`, () => {
            let token: CancellationTokenSource;
            setup(() => {
                const document = mock<NotebookDocument>();
                editor = mock<NotebookEditor>();
                const interactiveWindowProvider = mock<IInteractiveWindowProvider>();
                const activeInteractiveWindow = mock<IInteractiveWindow>();
                token = new CancellationTokenSource();
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
            teardown(() => token.dispose());
            test('Check if ipykernel is installed', async () => {
                when(installer.isInstalled(Product.ipykernel, interpreter)).thenResolve(true);

                await dependencyService.installMissingDependencies(
                    resource,
                    metadata,
                    new DisplayOptions(false),
                    token.token
                );

                verify(installer.isInstalled(Product.ipykernel, interpreter)).once();
                verify(installer.isInstalled(anything(), anything())).once();
            });
            test('Do not prompt if if ipykernel is installed', async () => {
                when(installer.isInstalled(Product.ipykernel, interpreter)).thenResolve(true);

                await dependencyService.installMissingDependencies(
                    resource,
                    metadata,
                    new DisplayOptions(false),
                    token.token
                );

                verify(appShell.showInformationMessage(anything(), anything(), anything())).never();
            });
            test('Prompt if if ipykernel is not installed', async () => {
                when(installer.isInstalled(Product.ipykernel, interpreter)).thenResolve(false);
                when(appShell.showInformationMessage(anything(), anything())).thenResolve(Common.install() as any);

                const result = await dependencyService.installMissingDependencies(
                    Uri.file('one.ipynb'),
                    metadata,
                    new DisplayOptions(false),
                    token.token
                );
                assert.strictEqual(result, KernelInterpreterDependencyResponse.cancel);

                verify(appShell.showInformationMessage(anything(), anything(), anything())).never();
            });
            test('Install ipykernel', async () => {
                when(installer.isInstalled(Product.ipykernel, interpreter)).thenResolve(false);
                when(installer.install(Product.ipykernel, interpreter, anything(), anything(), anything())).thenResolve(
                    InstallerResponse.Installed
                );
                when(appShell.showInformationMessage(anything(), anything(), anything())).thenResolve(
                    Common.install() as any
                );
                when(appShell.showInformationMessage(anything(), anything(), anything(), anything())).thenResolve(
                    Common.install() as any
                );

                await dependencyService.installMissingDependencies(
                    resource,
                    metadata,
                    new DisplayOptions(false),
                    token.token
                );
            });
            test('Install ipykernel second time should result in a re-install', async () => {
                when(memento.get(anything(), anything())).thenReturn(true);
                when(installer.isInstalled(Product.ipykernel, interpreter)).thenResolve(false);
                when(installer.install(Product.ipykernel, interpreter, anything(), true, anything())).thenResolve(
                    InstallerResponse.Installed
                );
                when(appShell.showInformationMessage(anything(), anything(), Common.install())).thenResolve(
                    Common.install() as any
                );
                when(appShell.showInformationMessage(anything(), anything(), Common.install(), anything())).thenResolve(
                    Common.install() as any
                );

                await dependencyService.installMissingDependencies(
                    resource,
                    metadata,
                    new DisplayOptions(false),
                    token.token
                );
            });
            test('Bubble installation errors', async () => {
                when(installer.isInstalled(Product.ipykernel, interpreter)).thenResolve(false);
                when(installer.install(Product.ipykernel, interpreter, anything(), anything(), anything())).thenReject(
                    new Error('Install failed - kaboom')
                );
                when(appShell.showInformationMessage(anything(), anything(), anything())).thenResolve(
                    Common.install() as any
                );
                when(appShell.showInformationMessage(anything(), anything(), anything(), anything())).thenResolve(
                    Common.install() as any
                );

                const result = await dependencyService.installMissingDependencies(
                    resource,
                    metadata,
                    new DisplayOptions(false),
                    token.token
                );

                assert.equal(result, KernelInterpreterDependencyResponse.failed);
            });
            test('Select kernel instead of installing', async function () {
                if (resource === undefined) {
                    return this.skip();
                }

                when(memento.get(anything(), anything())).thenReturn(false);
                when(installer.isInstalled(Product.ipykernel, interpreter)).thenResolve(false);
                when(appShell.showInformationMessage(anything(), anything(), anything(), anything())).thenResolve(
                    DataScience.selectKernel() as any
                );

                const result = await dependencyService.installMissingDependencies(
                    resource,
                    metadata,
                    new DisplayOptions(false),
                    token.token
                );
                assert.strictEqual(
                    result,
                    KernelInterpreterDependencyResponse.selectDifferentKernel,
                    'Kernel was not switched'
                );
            });
            test('Throw an error if cancelling the prompt', async function () {
                if (resource === undefined) {
                    return this.skip();
                }

                when(memento.get(anything(), anything())).thenReturn(false);
                when(installer.isInstalled(Product.ipykernel, interpreter)).thenResolve(false);
                when(appShell.showInformationMessage(anything(), anything(), anything(), anything())).thenResolve();

                const result = await dependencyService.installMissingDependencies(
                    resource,
                    metadata,
                    new DisplayOptions(false),
                    token.token
                );

                assert.equal(result, KernelInterpreterDependencyResponse.cancel, 'Wasnt sCanceled');
                verify(cmdManager.executeCommand('notebook.selectKernel', anything())).never();
            });
        });
    });
});
