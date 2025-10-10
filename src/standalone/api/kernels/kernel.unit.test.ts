// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as sinon from 'sinon';
import { when, instance, mock, anything } from 'ts-mockito';
import {
    CancellationTokenSource,
    Disposable,
    EventEmitter,
    ExtensionMode,
    NotebookController,
    SecretStorage,
    SecretStorageChangeEvent,
    type CancellationToken,
    type NotebookDocument
} from 'vscode';
import { clearApiAccess } from './apiAccess';
import { mockedVSCodeNamespaces, resetVSCodeMocks } from '../../../test/vscode-mock';
import { IDisposable, IDisposableRegistry, IExtensionContext } from '../../../platform/common/types';
import { dispose } from '../../../platform/common/utils/lifecycle';
import { ServiceContainer } from '../../../platform/ioc/container';
import {
    IKernelProvider,
    IKernelSession,
    INotebookKernelExecution,
    KernelConnectionMetadata,
    type IKernel
} from '../../../kernels/types';
import { createMockedNotebookDocument } from '../../../test/datascience/editor-integration/helpers';
import { IControllerRegistration, IVSCodeNotebookController } from '../../../notebooks/controllers/types';
import { createKernelApiForExtension } from './kernel';
import { noop } from '../../../test/core';
import { JVSC_EXTENSION_ID_FOR_TESTS } from '../../../test/constants';
import { IKernelConnection } from '@jupyterlab/services/lib/kernel/kernel';
import { NotebookCellOutput } from 'vscode';

suite('Kernel Api', () => {
    let disposables: IDisposable[] = [];
    let context: IExtensionContext;
    let secrets: SecretStorage;
    let onDidChangeSecrets: EventEmitter<SecretStorageChangeEvent>;
    const secretStorage = new Map<string, string>();
    let kernel: IKernel;
    let notebook: NotebookDocument;
    let tokenSource: CancellationTokenSource;
    let token: CancellationToken;
    setup(() => {
        clearApiAccess();
        resetVSCodeMocks();
        disposables.push(new Disposable(() => resetVSCodeMocks()));
        tokenSource = new CancellationTokenSource();
        token = tokenSource.token;
        disposables.push(tokenSource);
        disposables;
        when(mockedVSCodeNamespaces.workspace.isTrusted).thenReturn(true);
        when(mockedVSCodeNamespaces.window.onDidChangeVisibleNotebookEditors(anything(), anything())).thenReturn({
            dispose: noop
        });
        secretStorage.clear();
        context = mock<IExtensionContext>();
        secrets = mock<SecretStorage>();
        onDidChangeSecrets = new EventEmitter<SecretStorageChangeEvent>();
        const serviceContainer = mock<ServiceContainer>();
        sinon.stub(ServiceContainer, 'instance').get(() => instance(serviceContainer));
        when(serviceContainer.get<IExtensionContext>(IExtensionContext)).thenReturn(instance(context));
        when(serviceContainer.get<IDisposableRegistry>(IDisposableRegistry)).thenReturn(
            disposables as unknown as IDisposableRegistry
        );
        when(context.extensionMode).thenReturn(ExtensionMode.Production);
        when(context.secrets).thenReturn(instance(secrets));
        when(secrets.onDidChange).thenReturn(onDidChangeSecrets.event);
        when(secrets.get(anything())).thenCall((key) => secretStorage.get(key));
        when(secrets.store(anything(), anything())).thenCall((key, value) => {
            secretStorage.set(key, value);
            onDidChangeSecrets.fire({ key });
            return Promise.resolve();
        });

        disposables.push(new Disposable(() => sinon.restore()));
        disposables.push(new Disposable(() => clearApiAccess()));

        const kernelConnection = mock<KernelConnectionMetadata>();
        when(kernelConnection.kind).thenReturn('connectToLiveRemoteKernel');
        kernel = mock<IKernel>();
        when(kernel.kernelConnectionMetadata).thenReturn(instance(kernelConnection));
        when(kernel.disposed).thenReturn(false);
        when(kernel.startedAtLeastOnce).thenReturn(true);
        notebook = createMockedNotebookDocument([]);
        when(kernel.notebook).thenReturn(notebook);
        const kernelSession = mock<IKernelSession>();
        when(kernel.session).thenReturn(instance(kernelSession));
        when(kernelSession.kernel).thenReturn(instance(mock<IKernelConnection>()));

        const controllerRegistration = mock<IControllerRegistration>();
        when(serviceContainer.get<IControllerRegistration>(IControllerRegistration)).thenReturn(
            instance(controllerRegistration)
        );
        const vscController = mock<IVSCodeNotebookController>();
        const controller = mock<NotebookController>();
        const execution = mock<INotebookKernelExecution>();
        const kernelProvider = mock<IKernelProvider>();
        when(execution.executeCode(anything(), anything(), anything(), anything())).thenCall(async function* () {
            // Yield a dummy NotebookCellOutput to match the expected type
            yield new NotebookCellOutput([]);
        });
        when(kernelProvider.getKernelExecution(instance(kernel))).thenReturn(instance(execution));
        when(serviceContainer.get<IKernelProvider>(IKernelProvider)).thenReturn(instance(kernelProvider));
        when(vscController.controller).thenReturn(instance(controller));
        when(controllerRegistration.getSelected(instance(notebook))).thenReturn(instance(vscController));
    });
    teardown(() => (disposables = dispose(disposables)));

    test('Verify Access Denied error message has expected value for the property `name`', async () => {
        try {
            const { api } = createKernelApiForExtension('xyz', instance(kernel));
            for await (const x of api.executeCode('bogus', token)) {
                assert.fail(`Should have failed without producing any value such as ${x}`);
            }
            assert.fail('Should have failed');
        } catch (ex) {
            assert.equal(ex.name, 'vscode.jupyter.apiAccessRevoked');
        }
    });
    test('Verify Kernel Shutdown', async () => {
        when(kernel.status).thenReturn('idle');
        when(kernel.shutdown()).thenResolve();
        when(kernel.dispose()).thenCall(() => when(kernel.status).thenReturn('dead'));

        const { api } = createKernelApiForExtension(JVSC_EXTENSION_ID_FOR_TESTS, instance(kernel));
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _ of api.executeCode('bogus', token)) {
            //
        }
        assert.equal(api.status, 'idle');
        await api.shutdown();
        assert.equal(api.status, 'dead');
    });
});
