// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { CancellationTokenSource, Memento, NotebookDocument, NotebookEditor, Uri } from 'vscode';
import { IApplicationShell, ICommandManager, IVSCodeNotebook } from '../../../../platform/common/application/types';
import { Common, DataScience } from '../../../../platform/common/utils/localize';
import { createInterpreterKernelSpec } from '../../../../kernels/helpers';
import { KernelDependencyService } from '../../../../kernels/kernelDependencyService.node';
import {
    IKernelProvider,
    KernelInterpreterDependencyResponse,
    PythonKernelConnectionMetadata
} from '../../../../kernels/types';
import { IServiceContainer } from '../../../../platform/ioc/types';
import { EnvironmentType } from '../../../../platform/pythonEnvironments/info';
import { IInstaller, Product, InstallerResponse } from '../../../../platform/interpreter/installer/types';
import { createPythonInterpreter } from '../../../utils/interpreters';
import { IInteractiveWindowProvider, IInteractiveWindow } from '../../../../interactive-window/types';
import { DisplayOptions } from '../../../../kernels/displayOptions';
import { IRawNotebookSupportedService } from '../../../../kernels/raw/types';
import { getResourceType } from '../../../../platform/common/utils';

/* eslint-disable @typescript-eslint/no-explicit-any */

// eslint-disable-next-line
suite('Kernel Dependency Service', () => {
    let dependencyService: KernelDependencyService;
    let notebooks: IVSCodeNotebook;
    let appShell: IApplicationShell;
    let cmdManager: ICommandManager;
    let installer: IInstaller;
    let serviceContainer: IServiceContainer;
    let kernelProvider: IKernelProvider;
    let memento: Memento;
    let editor: NotebookEditor;

    const interpreter = createPythonInterpreter({
        displayName: 'name',
        envType: EnvironmentType.Conda,
        uri: Uri.file('abc')
    });
    let metadata: PythonKernelConnectionMetadata;
    suiteSetup(async () => {
        metadata = PythonKernelConnectionMetadata.create({
            interpreter,
            kernelSpec: await createInterpreterKernelSpec(interpreter, Uri.file('')),
            id: '1'
        });
    });
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
                    when(interactiveWindowProvider.activeWindow).thenReturn(instance(activeInteractiveWindow));
                    when(serviceContainer.get<IInteractiveWindowProvider>(IInteractiveWindowProvider)).thenReturn(
                        instance(interactiveWindowProvider)
                    );
                }
                when(editor.notebook).thenReturn(instance(document));
            });
            teardown(() => token.dispose());
            test('Check if ipykernel is installed', async () => {
                when(installer.isInstalled(Product.ipykernel, interpreter)).thenResolve(true);

                await dependencyService.installMissingDependencies({
                    resource,
                    kernelConnection: metadata,
                    ui: new DisplayOptions(false),
                    token: token.token
                });

                verify(installer.isInstalled(Product.ipykernel, interpreter)).once();
                verify(installer.isInstalled(anything(), anything())).once();
            });
            test('Do not prompt if if ipykernel is installed', async () => {
                when(installer.isInstalled(Product.ipykernel, interpreter)).thenResolve(true);

                await dependencyService.installMissingDependencies({
                    resource,
                    kernelConnection: metadata,
                    ui: new DisplayOptions(false),
                    token: token.token
                });

                verify(appShell.showInformationMessage(anything(), anything(), anything())).never();
            });
            test('Prompt if if ipykernel is not installed', async () => {
                when(installer.isInstalled(Product.ipykernel, interpreter)).thenResolve(false);
                when(appShell.showInformationMessage(anything(), anything())).thenResolve(Common.install as any);

                const result = await dependencyService.installMissingDependencies({
                    resource: Uri.file('one.ipynb'),
                    kernelConnection: metadata,
                    ui: new DisplayOptions(false),
                    token: token.token
                });
                assert.strictEqual(result, KernelInterpreterDependencyResponse.cancel);

                verify(appShell.showInformationMessage(anything(), anything(), anything())).never();
            });
            test('Install ipykernel', async () => {
                when(installer.isInstalled(Product.ipykernel, interpreter)).thenResolve(false);
                when(installer.install(Product.ipykernel, interpreter, anything(), anything(), anything())).thenResolve(
                    InstallerResponse.Installed
                );
                when(appShell.showInformationMessage(anything(), anything(), anything())).thenResolve(
                    Common.install as any
                );
                when(appShell.showInformationMessage(anything(), anything(), anything(), anything())).thenResolve(
                    Common.install as any
                );

                await dependencyService.installMissingDependencies({
                    resource,
                    kernelConnection: metadata,
                    ui: new DisplayOptions(false),
                    token: token.token
                });
            });
            test('Install ipykernel second time should result in a re-install', async () => {
                when(memento.get(anything(), anything())).thenReturn(true);
                when(installer.isInstalled(Product.ipykernel, interpreter)).thenResolve(false);
                when(installer.install(Product.ipykernel, interpreter, anything(), true, anything())).thenResolve(
                    InstallerResponse.Installed
                );
                when(appShell.showInformationMessage(anything(), anything(), Common.install)).thenResolve(
                    Common.install as any
                );
                when(appShell.showInformationMessage(anything(), anything(), Common.install, anything)).thenResolve(
                    Common.install as any
                );

                await dependencyService.installMissingDependencies({
                    resource,
                    kernelConnection: metadata,
                    ui: new DisplayOptions(false),
                    token: token.token
                });
            });
            test('Bubble installation errors', async () => {
                when(installer.isInstalled(Product.ipykernel, interpreter)).thenResolve(false);
                when(installer.install(Product.ipykernel, interpreter, anything(), anything(), anything())).thenReject(
                    new Error('Install failed - kaboom')
                );
                when(appShell.showInformationMessage(anything(), anything(), anything())).thenResolve(
                    Common.install as any
                );
                when(appShell.showInformationMessage(anything(), anything(), anything(), anything())).thenResolve(
                    Common.install as any
                );
                when(
                    appShell.showInformationMessage(anything(), anything(), anything(), anything(), anything())
                ).thenResolve(Common.install as any);

                const result = await dependencyService.installMissingDependencies({
                    resource,
                    kernelConnection: metadata,
                    ui: new DisplayOptions(false),
                    token: token.token
                });

                assert.equal(result, KernelInterpreterDependencyResponse.failed);
            });
            test('Select kernel instead of installing', async function () {
                if (resource === undefined) {
                    return this.skip();
                }

                when(memento.get(anything(), anything())).thenReturn(false);
                when(installer.isInstalled(Product.ipykernel, interpreter)).thenResolve(false);
                when(
                    appShell.showInformationMessage(anything(), anything(), anything(), anything(), anything())
                ).thenResolve(DataScience.selectKernel as any);

                const result = await dependencyService.installMissingDependencies({
                    resource,
                    kernelConnection: metadata,
                    ui: new DisplayOptions(false),
                    token: token.token
                });
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

                const result = await dependencyService.installMissingDependencies({
                    resource,
                    kernelConnection: metadata,
                    ui: new DisplayOptions(false),
                    token: token.token
                });

                assert.equal(result, KernelInterpreterDependencyResponse.cancel, 'Wasnt sCanceled');
                verify(cmdManager.executeCommand('notebook.selectKernel', anything())).never();
            });
        });
    });
});
