// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { assert, use } from 'chai';

import { anything, instance, mock, verify, when } from 'ts-mockito';
import { EventEmitter, Memento, Uri } from 'vscode';
import { IJupyterServerUriEntry, IJupyterServerUriStorage } from '../../../kernels/jupyter/types';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { IDisposable } from '../../../platform/common/types';
import chaiAsPromised from 'chai-as-promised';
import {
    LiveRemoteKernelConnectionUsageTracker,
    mementoKeyToTrackRemoveKernelUrisAndSessionsUsedByResources
} from '../../../kernels/jupyter/connection/liveRemoteKernelConnectionTracker';
import { LiveRemoteKernelConnectionMetadata } from '../../../kernels/types';
import { generateUriFromRemoteProvider } from '../../../kernels/jupyter/jupyterUtils';
import { waitForCondition } from '../../../test/common';

use(chaiAsPromised);
suite('Live kernel Connection Tracker', async () => {
    let serverUriStorage: IJupyterServerUriStorage;
    let memento: Memento;
    let tracker: LiveRemoteKernelConnectionUsageTracker;
    let onDidRemoveUris: EventEmitter<IJupyterServerUriEntry[]>;
    const disposables: IDisposable[] = [];
    const server2Uri = 'http://one:1234/hello?token=1234';
    const serverProviderHandle = { handle: 'handle2', id: 'id2' };
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
        serverProviderHandle: serverProviderHandle
    });
    const remoteLiveKernel2 = LiveRemoteKernelConnectionMetadata.create({
        baseUrl: 'http://one:1234/',
        id: 'connectionId2',
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
        },
        serverProviderHandle: serverProviderHandle
    });
    const remoteLiveKernel3 = LiveRemoteKernelConnectionMetadata.create({
        baseUrl: 'http://one:1234/',
        id: 'connectionId3',
        kernelModel: {
            lastActivityTime: new Date(),
            id: 'modelId3',
            model: {
                id: 'modelId3',
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
        },
        serverProviderHandle: serverProviderHandle
    });
    setup(() => {
        serverUriStorage = mock<IJupyterServerUriStorage>();
        memento = mock<Memento>();
        onDidRemoveUris = new EventEmitter<IJupyterServerUriEntry[]>();
        disposables.push(onDidRemoveUris);
        when(serverUriStorage.onDidRemove).thenReturn(onDidRemoveUris.event);
        tracker = new LiveRemoteKernelConnectionUsageTracker(
            disposables,
            instance(serverUriStorage),
            instance(memento)
        );
    });
    teardown(() => {
        disposeAllDisposables(disposables);
    });

    test('Ensure event handler is added', () => {
        tracker.activate();
        verify(serverUriStorage.onDidRemove).once();
    });
    test('Kernel connection is not used if memento is empty', async () => {
        when(memento.get(anything(), anything())).thenCall((_, defaultValue) => defaultValue);

        tracker.activate();

        assert.isFalse(tracker.wasKernelUsed(remoteLiveKernel1));
    });
    test('Kernel connection is not used if memento is not empty but does not contain the same connection info', async () => {
        const cachedItems = {
            [generateUriFromRemoteProvider(
                remoteLiveKernel2.serverProviderHandle.id,
                remoteLiveKernel2.serverProviderHandle.handle
            )]: {
                [remoteLiveKernel2.kernelModel.id!]: [Uri.file('a.ipynb').toString()]
            }
        };
        when(memento.get(mementoKeyToTrackRemoveKernelUrisAndSessionsUsedByResources, anything())).thenCall(
            () => cachedItems
        );

        tracker.activate();

        assert.isFalse(tracker.wasKernelUsed(remoteLiveKernel1));
    });
    test('Kernel connection is used if connection is tracked in memento', async () => {
        const cachedItems = {
            [generateUriFromRemoteProvider(
                remoteLiveKernel2.serverProviderHandle.id,
                remoteLiveKernel2.serverProviderHandle.handle
            )]: {
                [remoteLiveKernel2.kernelModel.id!]: [Uri.file('a.ipynb').toString()]
            },
            [generateUriFromRemoteProvider(
                remoteLiveKernel1.serverProviderHandle.id,
                remoteLiveKernel1.serverProviderHandle.handle
            )]: {
                [remoteLiveKernel1.kernelModel.id!]: [Uri.file('a.ipynb').toString()]
            }
        };
        when(memento.get(mementoKeyToTrackRemoveKernelUrisAndSessionsUsedByResources, anything())).thenCall(
            () => cachedItems
        );

        tracker.activate();

        assert.isTrue(tracker.wasKernelUsed(remoteLiveKernel1));
    });
    test('Memento is updated to track usage of a kernel connection', async () => {
        const cachedItems: any = {};
        when(memento.get(mementoKeyToTrackRemoveKernelUrisAndSessionsUsedByResources, anything())).thenReturn(
            cachedItems
        );
        when(memento.update(mementoKeyToTrackRemoveKernelUrisAndSessionsUsedByResources, anything())).thenCall(
            (_, value) => {
                Object.assign(cachedItems, value);
                return Promise.resolve();
            }
        );

        tracker.activate();
        tracker.trackKernelIdAsUsed(
            Uri.file('a.ipynb'),
            remoteLiveKernel1.serverProviderHandle,
            remoteLiveKernel1.kernelModel.id!
        );

        assert.deepEqual(
            cachedItems[
                generateUriFromRemoteProvider(
                    remoteLiveKernel1.serverProviderHandle.id,
                    remoteLiveKernel1.serverProviderHandle.handle
                )
            ][remoteLiveKernel1.kernelModel.id!],
            [Uri.file('a.ipynb').toString()]
        );

        tracker.trackKernelIdAsUsed(
            Uri.file('a.ipynb'),
            remoteLiveKernel2.serverProviderHandle,
            remoteLiveKernel2.kernelModel.id!
        );

        assert.deepEqual(
            cachedItems[
                generateUriFromRemoteProvider(
                    remoteLiveKernel2.serverProviderHandle.id,
                    remoteLiveKernel2.serverProviderHandle.handle
                )
            ][remoteLiveKernel2.kernelModel.id!],
            [Uri.file('a.ipynb').toString()]
        );

        tracker.trackKernelIdAsUsed(
            Uri.file('a.ipynb'),
            remoteLiveKernel3.serverProviderHandle,
            remoteLiveKernel3.kernelModel.id!
        );

        assert.deepEqual(
            cachedItems[
                generateUriFromRemoteProvider(
                    remoteLiveKernel3.serverProviderHandle.id,
                    remoteLiveKernel3.serverProviderHandle.handle
                )
            ][remoteLiveKernel3.kernelModel.id!],
            [Uri.file('a.ipynb').toString()]
        );

        tracker.trackKernelIdAsUsed(
            Uri.file('b.ipynb'),
            remoteLiveKernel3.serverProviderHandle,
            remoteLiveKernel3.kernelModel.id!
        );

        assert.deepEqual(
            cachedItems[
                generateUriFromRemoteProvider(
                    remoteLiveKernel3.serverProviderHandle.id,
                    remoteLiveKernel3.serverProviderHandle.handle
                )
            ][remoteLiveKernel3.kernelModel.id!],
            [Uri.file('a.ipynb').toString(), Uri.file('b.ipynb').toString()]
        );

        assert.isTrue(tracker.wasKernelUsed(remoteLiveKernel1));
        assert.isTrue(tracker.wasKernelUsed(remoteLiveKernel2));
        assert.isTrue(tracker.wasKernelUsed(remoteLiveKernel3));

        // Remove a kernel connection from some other document.
        tracker.trackKernelIdAsNotUsed(
            Uri.file('xyz.ipynb'),
            remoteLiveKernel1.serverProviderHandle,
            remoteLiveKernel1.kernelModel.id!
        );

        assert.isTrue(tracker.wasKernelUsed(remoteLiveKernel1));
        assert.isTrue(tracker.wasKernelUsed(remoteLiveKernel2));
        assert.isTrue(tracker.wasKernelUsed(remoteLiveKernel3));

        // Remove a kernel connection from a tracked document.
        tracker.trackKernelIdAsNotUsed(
            Uri.file('a.ipynb'),
            remoteLiveKernel1.serverProviderHandle,
            remoteLiveKernel1.kernelModel.id!
        );

        assert.isFalse(tracker.wasKernelUsed(remoteLiveKernel1));
        assert.isTrue(tracker.wasKernelUsed(remoteLiveKernel2));
        assert.isTrue(tracker.wasKernelUsed(remoteLiveKernel3));

        // Forget the Uri connection all together.
        onDidRemoveUris.fire([{ uri: server2Uri, time: 0, provider: serverProviderHandle }]);

        await waitForCondition(
            () => {
                assert.isFalse(tracker.wasKernelUsed(remoteLiveKernel1));
                assert.isFalse(tracker.wasKernelUsed(remoteLiveKernel2));
                assert.isFalse(tracker.wasKernelUsed(remoteLiveKernel3));
                return true;
            },
            100,
            `Expected all to be false. But got ${[remoteLiveKernel1, remoteLiveKernel2, remoteLiveKernel3].map((item) =>
                tracker.wasKernelUsed(item)
            )}`
        );
    });
});
