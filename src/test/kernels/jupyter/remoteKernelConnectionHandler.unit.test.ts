/* eslint-disable @typescript-eslint/no-explicit-any */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { use } from 'chai';

import { anything, instance, mock, verify, when } from 'ts-mockito';
import { Disposable, EventEmitter, NotebookDocument, Uri } from 'vscode';
import { ILiveRemoteKernelConnectionUsageTracker } from '../../../kernels/jupyter/types';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { IDisposable } from '../../../platform/common/types';
import * as chaiAsPromised from 'chai-as-promised';
import {
    IKernel,
    IKernelProvider,
    isLocalConnection,
    KernelActionSource,
    KernelConnectionMetadata,
    KernelSocketInformation,
    LiveRemoteKernelConnectionMetadata,
    LocalKernelConnectionMetadata,
    RemoteKernelSpecConnectionMetadata
} from '../../../kernels/types';
import { PreferredRemoteKernelIdProvider } from '../../../kernels/jupyter/preferredRemoteKernelIdProvider';
import { RemoteKernelConnectionHandler } from '../../../kernels/jupyter/remoteKernelConnectionHandler';
import { INotebookControllerManager } from '../../../notebooks/types';
import { Subject } from 'rxjs';
import { IVSCodeNotebookController } from '../../../notebooks/controllers/types';

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
    let controllers: INotebookControllerManager;
    let kernelProvider: IKernelProvider;
    const disposables: IDisposable[] = [];
    // const server2Uri = 'http://one:1234/hello?token=1234';
    const remoteKernelSpec: RemoteKernelSpecConnectionMetadata = {
        baseUrl: 'baseUrl',
        id: 'remoteKernelSpec1',
        kind: 'startUsingRemoteKernelSpec',
        serverId: 'server1',
        kernelSpec: {
            argv: [],
            display_name: '',
            name: '',
            uri: Uri.file('')
        }
    };
    const localKernelSpec: LocalKernelConnectionMetadata = {
        id: 'localKernelSpec1',
        kernelSpec: {
            argv: [],
            display_name: '',
            name: '',
            uri: Uri.file('')
        },
        kind: 'startUsingLocalKernelSpec'
    };
    const remoteLiveKernel1: LiveRemoteKernelConnectionMetadata = {
        baseUrl: 'baseUrl',
        id: 'connectionId',
        kind: 'connectToLiveRemoteKernel',
        serverId: 'server1',
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
        }
    };
    setup(() => {
        onDidStartKernel = new EventEmitter<IKernel>();
        kernelProvider = mock<IKernelProvider>();
        controllers = mock<INotebookControllerManager>();
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
        when(controllers.onNotebookControllerSelectionChanged).thenReturn(onNotebookControllerSelectionChanged.event);
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
        disposeAllDisposables(disposables);
    });

    test('Ensure event handler is added', () => {
        remoteConnectionHandler.activate();
        verify(kernelProvider.onDidStartKernel).once();
    });
    function verifyRemoteKernelTracking(connection: KernelConnectionMetadata, source: KernelActionSource) {
        const kernel1 = mock<IKernel>();
        when(kernel1.kernelConnectionMetadata).thenReturn(connection);
        when(kernel1.creator).thenReturn(source);
        const subject = new Subject<KernelSocketInformation>();
        disposables.push(new Disposable(() => subject.unsubscribe()));
        when(kernel1.kernelSocket).thenReturn(subject);
        const nbUri = Uri.file('a.ipynb');
        when(kernel1.resourceUri).thenReturn(nbUri);
        when(kernel1.disposed).thenReturn(false);
        when(kernel1.disposing).thenReturn(false);

        remoteConnectionHandler.activate();
        onDidStartKernel.fire(instance(kernel1));

        verify(tracker.trackKernelIdAsUsed(anything(), anything(), anything())).never();
        verify(preferredRemoteKernelProvider.storePreferredRemoteKernelId(anything(), anything())).never();

        const kernelInfo: KernelSocketInformation = {
            options: {
                clientId: '',
                id: 'modelId1',
                model: {
                    id: 'modelId1',
                    name: ''
                },
                userName: ''
            }
        };
        subject.next(kernelInfo);

        if (connection.kind === 'startUsingRemoteKernelSpec' && source === 'jupyterExtension') {
            verify(tracker.trackKernelIdAsUsed(nbUri, remoteKernelSpec.serverId, kernelInfo.options.id)).once();
            verify(preferredRemoteKernelProvider.storePreferredRemoteKernelId(nbUri, kernelInfo.options.id)).once();
        } else {
            verify(tracker.trackKernelIdAsUsed(anything(), anything(), anything())).never();
            verify(preferredRemoteKernelProvider.storePreferredRemoteKernelId(anything(), anything())).never();
        }
    }
    function verifyRemoteKernelTrackingUponKernelSelection(connection: KernelConnectionMetadata, selected: boolean) {
        const controller = mock<IVSCodeNotebookController>();
        const notebook = mock<NotebookDocument>();
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
                    tracker.trackKernelIdAsUsed(nbUri, remoteKernelSpec.serverId, connection.kernelModel.id!)
                ).once();
            } else {
                verify(
                    tracker.trackKernelIdAsNotUsed(nbUri, remoteKernelSpec.serverId, connection.kernelModel.id!)
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
    test('When starting a remote kernel spec from a 3rd party extension ensure we do not track this', async () => {
        verifyRemoteKernelTracking(remoteKernelSpec, '3rdPartyExtension');
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
