// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { use } from 'chai';

import { anything, deepEqual, instance, mock, verify, when } from 'ts-mockito';
import { EventEmitter, NotebookDocument, Uri } from 'vscode';
import { ILiveRemoteKernelConnectionUsageTracker } from '../../kernels/jupyter/types';
import { dispose } from '../../platform/common/helpers';
import { IDisposable } from '../../platform/common/types';
import chaiAsPromised from 'chai-as-promised';
import {
    IKernel,
    IKernelProvider,
    IKernelSession,
    isLocalConnection,
    KernelActionSource,
    KernelConnectionMetadata,
    KernelSocketInformation,
    LiveRemoteKernelConnectionMetadata,
    LocalKernelSpecConnectionMetadata,
    RemoteKernelSpecConnectionMetadata
} from '../../kernels/types';
import { PreferredRemoteKernelIdProvider } from '../../kernels/jupyter/connection/preferredRemoteKernelIdProvider';
import { RemoteKernelConnectionHandler } from './remoteKernelConnectionHandler';
import { IControllerRegistration, IVSCodeNotebookController } from './types';
import { Kernel } from '@jupyterlab/services';

use(chaiAsPromised);
suite('Remote kernel connection handler', async () => {
    let tracker: ILiveRemoteKernelConnectionUsageTracker;
    let preferredRemoteKernelProvider: PreferredRemoteKernelIdProvider;
    let onDidStartKernel: EventEmitter<IKernel>;
    let onNotebookControllerSelectionChanged: EventEmitter<{
        selected: boolean;
        notebook: NotebookDocument;
        controller: IVSCodeNotebookController;
    }>;
    let remoteConnectionHandler: RemoteKernelConnectionHandler;
    let controllers: IControllerRegistration;
    let kernelProvider: IKernelProvider;
    const disposables: IDisposable[] = [];
    // const server2Uri = 'http://one:1234/hello?token=1234';
    const remoteKernelSpec = RemoteKernelSpecConnectionMetadata.create({
        baseUrl: 'baseUrl',
        id: 'remoteKernelSpec1',
        kernelSpec: {
            argv: [],
            display_name: '',
            name: '',
            executable: ''
        },
        serverProviderHandle: { handle: 'handle', id: 'id', extensionId: '' }
    });
    const localKernelSpec = LocalKernelSpecConnectionMetadata.create({
        id: 'localKernelSpec1',
        kernelSpec: {
            argv: [],
            display_name: '',
            name: '',
            executable: ''
        }
    });
    const remoteLiveKernel1 = LiveRemoteKernelConnectionMetadata.create({
        baseUrl: 'baseUrl',
        id: 'connectionId',
        kernelModel: {
            lastActivityTime: new Date(),
            id: 'model1',
            model: {
                id: 'modelId',
                kernel: {
                    id: 'kernelId',
                    name: 'kernelName'
                },
                name: 'modelName',
                path: '',
                type: ''
            },
            name: '',
            numberOfConnections: 0
        },
        serverProviderHandle: { handle: 'handle', id: 'id', extensionId: '' }
    });
    setup(() => {
        onDidStartKernel = new EventEmitter<IKernel>();
        kernelProvider = mock<IKernelProvider>();
        controllers = mock<IControllerRegistration>();
        tracker = mock<ILiveRemoteKernelConnectionUsageTracker>();
        preferredRemoteKernelProvider = mock<PreferredRemoteKernelIdProvider>();
        onNotebookControllerSelectionChanged = new EventEmitter<{
            selected: boolean;
            notebook: NotebookDocument;
            controller: IVSCodeNotebookController;
        }>();

        disposables.push(onDidStartKernel);
        disposables.push(onNotebookControllerSelectionChanged);

        when(kernelProvider.onDidStartKernel).thenReturn(onDidStartKernel.event);
        when(controllers.onControllerSelectionChanged).thenReturn(onNotebookControllerSelectionChanged.event);
        when(preferredRemoteKernelProvider.storePreferredRemoteKernelId(anything(), anything())).thenResolve();
        when(preferredRemoteKernelProvider.clearPreferredRemoteKernelId(anything())).thenResolve();

        remoteConnectionHandler = new RemoteKernelConnectionHandler(
            disposables,
            instance(kernelProvider),
            instance(controllers),
            instance(tracker),
            instance(preferredRemoteKernelProvider)
        );
    });
    teardown(() => {
        dispose(disposables);
    });

    test('Ensure event handler is added', () => {
        remoteConnectionHandler.activate();
        verify(kernelProvider.onDidStartKernel).once();
    });
    function verifyRemoteKernelTracking(connection: KernelConnectionMetadata, source: KernelActionSource) {
        const kernel1 = mock<IKernel>();
        when(kernel1.kernelConnectionMetadata).thenReturn(connection);
        when(kernel1.creator).thenReturn('jupyterExtension');
        const session = mock<IKernelSession>();
        when(kernel1.session).thenReturn(instance(session));
        const kernelConnection = mock<Kernel.IKernelConnection>();
        when(session.kernel).thenReturn(instance(kernelConnection));
        when(kernelConnection.id).thenReturn('_KernelId_');
        const subject = new EventEmitter<KernelSocketInformation>();
        disposables.push(subject);
        when(kernel1.kernelSocket).thenReturn(subject.event);
        const nbUri = Uri.file('a.ipynb');
        when(kernel1.resourceUri).thenReturn(nbUri);
        when(kernel1.disposed).thenReturn(false);
        when(kernel1.disposing).thenReturn(false);

        remoteConnectionHandler.activate();
        onDidStartKernel.fire(instance(kernel1));

        verify(tracker.trackKernelIdAsUsed(anything(), anything(), anything())).never();
        verify(preferredRemoteKernelProvider.storePreferredRemoteKernelId(anything(), anything())).never();
        subject.fire({});

        if (connection.kind === 'startUsingRemoteKernelSpec' && source === 'jupyterExtension') {
            verify(
                tracker.trackKernelIdAsUsed(nbUri, deepEqual(remoteKernelSpec.serverProviderHandle), '_KernelId_')
            ).once();
            verify(preferredRemoteKernelProvider.storePreferredRemoteKernelId(nbUri, '_KernelId_')).once();
        } else {
            verify(tracker.trackKernelIdAsUsed(anything(), anything(), anything())).never();
            verify(preferredRemoteKernelProvider.storePreferredRemoteKernelId(anything(), anything())).never();
        }
    }
    function verifyRemoteKernelTrackingUponKernelSelection(connection: KernelConnectionMetadata, selected: boolean) {
        const controller = mock<IVSCodeNotebookController>();
        const notebook = mock<NotebookDocument>();
        when(notebook.isClosed).thenReturn(false);
        const nbUri = Uri.file('a.ipynb');
        when(notebook.uri).thenReturn(nbUri);
        when(controller.connection).thenReturn(connection);

        remoteConnectionHandler.activate();

        verify(tracker.trackKernelIdAsUsed(anything(), anything(), anything())).never();
        verify(preferredRemoteKernelProvider.storePreferredRemoteKernelId(anything(), anything())).never();

        onNotebookControllerSelectionChanged.fire({
            controller: instance(controller),
            notebook: instance(notebook),
            selected
        });

        if (connection.kind === 'connectToLiveRemoteKernel') {
            if (selected) {
                verify(
                    tracker.trackKernelIdAsUsed(
                        nbUri,
                        deepEqual(remoteKernelSpec.serverProviderHandle),
                        connection.kernelModel.id!
                    )
                ).once();
            } else {
                verify(
                    tracker.trackKernelIdAsNotUsed(
                        nbUri,
                        deepEqual(remoteKernelSpec.serverProviderHandle),
                        connection.kernelModel.id!
                    )
                ).once();
            }
        } else {
            verify(tracker.trackKernelIdAsUsed(anything(), anything(), anything())).never();
        }

        if (selected && isLocalConnection(connection)) {
            verify(preferredRemoteKernelProvider.clearPreferredRemoteKernelId(nbUri)).once();
        }
    }
    test('When starting a remote kernel spec ensure we track this', async () => {
        verifyRemoteKernelTracking(remoteKernelSpec, 'jupyterExtension');
    });
    test('When starting a local kernel spec ensure we do not track this', async () => {
        verifyRemoteKernelTracking(localKernelSpec, 'jupyterExtension');
    });
    test('When starting a local kernel spec from a 3rd party extension ensure we do not track this', async () => {
        verifyRemoteKernelTracking(localKernelSpec, '3rdPartyExtension');
    });
    test('When starting a kernel related to a live kernel ensure we do not track this, as it will be tracked when the kernel is selected', async () => {
        verifyRemoteKernelTracking(remoteLiveKernel1, 'jupyterExtension');
    });
    test('When starting a kernel related to a live kernel from a 3rd party extension ensure we do not track this', async () => {
        verifyRemoteKernelTracking(remoteLiveKernel1, '3rdPartyExtension');
    });

    test('Upon selecting a local kernelspec, ensure we clear the preferred remote kernel & not track this kernel', () => {
        verifyRemoteKernelTrackingUponKernelSelection(localKernelSpec, true);
    });
    test('Upon selecting a remote kernelspec, ensure we do not not track this kernel', () => {
        verifyRemoteKernelTrackingUponKernelSelection(remoteKernelSpec, true);
    });
    test('Upon selecting a remote live kernel, ensure we track this kernel', () => {
        verifyRemoteKernelTrackingUponKernelSelection(remoteLiveKernel1, true);
    });
    test('Upon un-selecting a remote live kernel, ensure we mark this kernel as no longer used', () => {
        verifyRemoteKernelTrackingUponKernelSelection(remoteLiveKernel1, false);
    });
});
