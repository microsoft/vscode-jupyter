// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as sinon from 'sinon';
import type { Event } from 'vscode';
import type { IRemoteKernelFinder } from '../../../kernels/jupyter/types';
import { createJupyterServerKernelDiscovery } from './serverKernelDiscovery';

suite('Jupyter server kernel discovery facade', () => {
    let status: IRemoteKernelFinder['status'];
    let lastError: Error | undefined;
    let onDidChangeStatus: Event<void>;
    let fireStatusChanged: () => void;
    let finder: IRemoteKernelFinder;

    setup(() => {
        status = 'idle';
        lastError = undefined;
        const listeners: (() => unknown)[] = [];
        onDidChangeStatus = ((listener: () => unknown) => {
            listeners.push(listener);
            return { dispose: () => undefined };
        }) as Event<void>;
        fireStatusChanged = () => listeners.forEach((listener) => listener());
        finder = {
            get status() {
                return status;
            },
            get lastError() {
                return lastError;
            },
            onDidChangeStatus
        } as unknown as IRemoteKernelFinder;
    });

    test('is frozen and exposes exactly the public discovery fields', () => {
        const discovery = createJupyterServerKernelDiscovery(finder);

        assert.isTrue(Object.isFrozen(discovery));
        assert.deepEqual(Reflect.ownKeys(discovery), ['status', 'lastError', 'onDidChangeStatus']);
    });

    test('reads status dynamically from the finder', () => {
        const discovery = createJupyterServerKernelDiscovery(finder);

        assert.strictEqual(discovery.status, 'idle');
        status = 'discovering';
        assert.strictEqual(discovery.status, 'discovering');
        status = 'idle';
        assert.strictEqual(discovery.status, 'idle');
    });

    test('reads lastError dynamically from the finder', () => {
        const discovery = createJupyterServerKernelDiscovery(finder);
        const error = new Error('Discovery failed');

        assert.isUndefined(discovery.lastError);
        lastError = error;
        assert.strictEqual(discovery.lastError, error);
        lastError = undefined;
        assert.isUndefined(discovery.lastError);
    });

    test('reuses the finder status event', () => {
        const discovery = createJupyterServerKernelDiscovery(finder);
        const listener = sinon.stub();
        discovery.onDidChangeStatus(listener);

        assert.strictEqual(discovery.onDidChangeStatus, finder.onDidChangeStatus);
        fireStatusChanged();
        sinon.assert.calledOnce(listener);
    });
});
