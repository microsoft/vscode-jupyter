// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as sinon from 'sinon';
import { Uri } from 'vscode';
import {
    LiveRemoteKernelConnectionMetadata,
    LocalKernelSpecConnectionMetadata,
    PythonKernelConnectionMetadata,
    RemoteKernelSpecConnectionMetadata,
    isRemoteConnection,
    isLocalConnection
} from './types';

suite('Kernel Kill Functionality - Type Detection', () => {
    test('isRemoteConnection should correctly identify remote kernels', () => {
        // Arrange
        const remoteConnection = LiveRemoteKernelConnectionMetadata.create({
            baseUrl: 'http://localhost:8888',
            id: 'remote-kernel',
            kernelModel: {
                lastActivityTime: new Date(),
                id: 'model1',
                model: {
                    id: 'modelId',
                    kernel: {
                        id: 'kernelId',
                        name: 'kernelName'
                    }
                },
                name: 'python3',
                numberOfConnections: 1
            },
            serverProviderHandle: { handle: 'handle', id: 'id', extensionId: 'test' }
        });

        // Act & Assert
        assert.isTrue(isRemoteConnection(remoteConnection), 'LiveRemoteKernelConnectionMetadata should be identified as remote');
        assert.isFalse(isLocalConnection(remoteConnection), 'LiveRemoteKernelConnectionMetadata should not be identified as local');
    });

    test('isLocalConnection should correctly identify local kernels', () => {
        // Arrange
        const localConnection = LocalKernelSpecConnectionMetadata.create({
            id: 'local-kernel',
            kernelSpec: {
                argv: ['python'],
                display_name: 'Python 3',
                executable: 'python',
                language: 'python',
                name: 'python3'
            }
        });

        // Act & Assert
        assert.isTrue(isLocalConnection(localConnection), 'LocalKernelSpecConnectionMetadata should be identified as local');
        assert.isFalse(isRemoteConnection(localConnection), 'LocalKernelSpecConnectionMetadata should not be identified as remote');
    });

    test('isLocalConnection should correctly identify Python kernel connections', () => {
        // Arrange
        const pythonConnection = PythonKernelConnectionMetadata.create({
            id: 'python-kernel',
            interpreter: {
                id: 'python-id',
                uri: Uri.file('/usr/bin/python')
            },
            kernelSpec: {
                argv: ['python'],
                display_name: 'Python 3',
                executable: 'python',
                language: 'python',
                name: 'python3'
            }
        });

        // Act & Assert
        assert.isTrue(isLocalConnection(pythonConnection), 'PythonKernelConnectionMetadata should be identified as local');
        assert.isFalse(isRemoteConnection(pythonConnection), 'PythonKernelConnectionMetadata should not be identified as remote');
    });

    test('LiveRemoteKernelConnectionMetadata should have baseUrl property', () => {
        // Arrange
        const remoteConnection = LiveRemoteKernelConnectionMetadata.create({
            baseUrl: 'http://localhost:8888',
            id: 'remote-kernel',
            kernelModel: {
                lastActivityTime: new Date(),
                id: 'model1',
                model: {
                    id: 'modelId',
                    kernel: {
                        id: 'kernelId',
                        name: 'kernelName'
                    }
                },
                name: 'python3',
                numberOfConnections: 1
            },
            serverProviderHandle: { handle: 'handle', id: 'id', extensionId: 'test' }
        });

        // Act & Assert
        assert.equal(remoteConnection.baseUrl, 'http://localhost:8888', 'Live remote kernel should have correct baseUrl');
        assert.isDefined(remoteConnection.serverProviderHandle, 'Live remote kernel should have serverProviderHandle');
        assert.equal(remoteConnection.kind, 'connectToLiveRemoteKernel', 'Should have correct kind');
    });

    test('RemoteKernelSpecConnectionMetadata should be identified as remote and have baseUrl', () => {
        // Arrange
        const remoteKernelSpec = RemoteKernelSpecConnectionMetadata.create({
            baseUrl: 'http://localhost:8888',
            id: 'remote-kernel-spec',
            kernelSpec: {
                argv: ['python'],
                display_name: 'Python 3',
                executable: 'python',
                language: 'python',
                name: 'python3'
            },
            serverProviderHandle: { handle: 'handle', id: 'id', extensionId: 'test' }
        });

        // Act & Assert
        assert.isTrue(isRemoteConnection(remoteKernelSpec), 'RemoteKernelSpecConnectionMetadata should be identified as remote');
        assert.isFalse(isLocalConnection(remoteKernelSpec), 'RemoteKernelSpecConnectionMetadata should not be identified as local');
        assert.equal(remoteKernelSpec.baseUrl, 'http://localhost:8888', 'Remote kernel spec should have correct baseUrl');
        assert.isDefined(remoteKernelSpec.serverProviderHandle, 'Remote kernel spec should have serverProviderHandle');
        assert.equal(remoteKernelSpec.kind, 'startUsingRemoteKernelSpec', 'Should have correct kind');
    });
});

// This test validates the kill method logic integration points
suite('Kernel Kill Logic Integration Points', () => {
    test('KernelAPI.shutdownKernel should be available from @jupyterlab/services', () => {
        // This test validates that the required API is available
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { KernelAPI } = require('@jupyterlab/services');
            assert.isDefined(KernelAPI, 'KernelAPI should be available');
            assert.isFunction(KernelAPI.shutdownKernel, 'KernelAPI.shutdownKernel should be a function');
        } catch (ex) {
            // In test environment, the module might not be available, which is expected
            assert.include(ex.message, 'Cannot find module', 'Expected module not found error in test environment');
        }
    });

    test('ServerConnection.makeSettings should be available from @jupyterlab/services', () => {
        // This test validates that the required API is available
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { ServerConnection } = require('@jupyterlab/services');
            assert.isDefined(ServerConnection, 'ServerConnection should be available');
            assert.isFunction(ServerConnection.makeSettings, 'ServerConnection.makeSettings should be a function');
        } catch (ex) {
            // In test environment, the module might not be available, which is expected
            assert.include(ex.message, 'Cannot find module', 'Expected module not found error in test environment');
        }
    });
});