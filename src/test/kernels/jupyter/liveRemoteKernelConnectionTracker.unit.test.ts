/* eslint-disable @typescript-eslint/no-explicit-any */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { assert, use } from 'chai';

import { anything, instance, mock, verify, when } from 'ts-mockito';
import { EventEmitter, Memento, Uri } from 'vscode';
import { IJupyterServerUriStorage } from '../../../kernels/jupyter/types';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { IDisposable } from '../../../platform/common/types';
import * as chaiAsPromised from 'chai-as-promised';
import {
    LiveRemoteKernelConnectionUsageTracker,
    mementoKeyToTrackRemoveKernelUrisAndSessionsUsedByResources
} from '../../../kernels/jupyter/liveRemoteKernelConnectionTracker';
import { LiveRemoteKernelConnectionMetadata } from '../../../kernels/types';
import { computeServerId } from '../../../kernels/jupyter/jupyterUtils';

use(chaiAsPromised);
suite('Live kernel Connection Tracker', async () => {
    let serverUriStorage: IJupyterServerUriStorage;
    let memento: Memento;
    let tracker: LiveRemoteKernelConnectionUsageTracker;
    let onDidRemoveUri: EventEmitter<string>;
    const disposables: IDisposable[] = [];
    const server2Uri = 'http://one:1234/hello?token=1234';
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
    const remoteLiveKernel2: LiveRemoteKernelConnectionMetadata = {
        baseUrl: 'http://one:1234/',
        id: 'connectionId2',
        kind: 'connectToLiveRemoteKernel',
        serverId: computeServerId(server2Uri),
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
        }
    };
    const remoteLiveKernel3: LiveRemoteKernelConnectionMetadata = {
        baseUrl: 'http://one:1234/',
        id: 'connectionId3',
        kind: 'connectToLiveRemoteKernel',
        serverId: computeServerId(server2Uri),
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
        }
    };
    setup(() => {
        serverUriStorage = mock<IJupyterServerUriStorage>();
        memento = mock<Memento>();
        onDidRemoveUri = new EventEmitter<string>();
        disposables.push(onDidRemoveUri);
        when(serverUriStorage.onDidRemoveUri).thenReturn(onDidRemoveUri.event);
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
        verify(serverUriStorage.onDidRemoveUri).once();
    });
    test('Kernel connection is not used if memento is empty', async () => {
        when(memento.get(anything(), anything())).thenCall((_, defaultValue) => defaultValue);

        tracker.activate();

        assert.isFalse(tracker.wasKernelUsed(remoteLiveKernel1));
    });
    test('Kernel connection is not used if memento is not empty but does not contain the same connection info', async () => {
        const cachedItems = {
            [remoteLiveKernel2.serverId]: {
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
            [remoteLiveKernel2.serverId]: {
                [remoteLiveKernel2.kernelModel.id!]: [Uri.file('a.ipynb').toString()]
            },
            [remoteLiveKernel1.serverId]: {
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
        tracker.trackKernelIdAsUsed(Uri.file('a.ipynb'), remoteLiveKernel1.serverId, remoteLiveKernel1.kernelModel.id!);

        assert.deepEqual(cachedItems[remoteLiveKernel1.serverId][remoteLiveKernel1.kernelModel.id!], [
            Uri.file('a.ipynb').toString()
        ]);

        tracker.trackKernelIdAsUsed(Uri.file('a.ipynb'), remoteLiveKernel2.serverId, remoteLiveKernel2.kernelModel.id!);

        assert.deepEqual(cachedItems[remoteLiveKernel2.serverId][remoteLiveKernel2.kernelModel.id!], [
            Uri.file('a.ipynb').toString()
        ]);

        tracker.trackKernelIdAsUsed(Uri.file('a.ipynb'), remoteLiveKernel3.serverId, remoteLiveKernel3.kernelModel.id!);

        assert.deepEqual(cachedItems[remoteLiveKernel3.serverId][remoteLiveKernel3.kernelModel.id!], [
            Uri.file('a.ipynb').toString()
        ]);

        tracker.trackKernelIdAsUsed(Uri.file('b.ipynb'), remoteLiveKernel3.serverId, remoteLiveKernel3.kernelModel.id!);

        assert.deepEqual(cachedItems[remoteLiveKernel3.serverId][remoteLiveKernel3.kernelModel.id!], [
            Uri.file('a.ipynb').toString(),
            Uri.file('b.ipynb').toString()
        ]);

        assert.isTrue(tracker.wasKernelUsed(remoteLiveKernel1));
        assert.isTrue(tracker.wasKernelUsed(remoteLiveKernel2));
        assert.isTrue(tracker.wasKernelUsed(remoteLiveKernel3));

        // Remove a kernel connection from some other document.
        tracker.trackKernelIdAsNotUsed(
            Uri.file('xyz.ipynb'),
            remoteLiveKernel1.serverId,
            remoteLiveKernel1.kernelModel.id!
        );

        assert.isTrue(tracker.wasKernelUsed(remoteLiveKernel1));
        assert.isTrue(tracker.wasKernelUsed(remoteLiveKernel2));
        assert.isTrue(tracker.wasKernelUsed(remoteLiveKernel3));

        // Remove a kernel connection from a tracked document.
        tracker.trackKernelIdAsNotUsed(
            Uri.file('a.ipynb'),
            remoteLiveKernel1.serverId,
            remoteLiveKernel1.kernelModel.id!
        );

        assert.isFalse(tracker.wasKernelUsed(remoteLiveKernel1));
        assert.isTrue(tracker.wasKernelUsed(remoteLiveKernel2));
        assert.isTrue(tracker.wasKernelUsed(remoteLiveKernel3));

        // Forget the Uir connection all together.
        onDidRemoveUri.fire(server2Uri);

        assert.isFalse(tracker.wasKernelUsed(remoteLiveKernel1));
        assert.isFalse(tracker.wasKernelUsed(remoteLiveKernel2));
        assert.isFalse(tracker.wasKernelUsed(remoteLiveKernel3));

        assert.isEmpty(cachedItems);
    });
});
