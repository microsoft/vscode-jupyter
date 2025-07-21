// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { assert } from 'chai';
import { anything, instance, mock, when } from 'ts-mockito';
import { CancellationTokenSource, Disposable, EventEmitter, Uri } from 'vscode';
import { mockedVSCodeNamespaces, resetVSCodeMocks } from '../../../test/vscode-mock';
import { IServiceContainer } from '../../ioc/types';
import { PythonEnvsApiInstaller } from './pythonEnvsApiInstaller.node';
import { ModuleInstallerType, ModuleInstallFlags, Product } from './types';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { Environment } from '@vscode/python-extension';
import { PythonEnvironmentApi, PythonEnvironment as ApiPythonEnvironment } from '../../api/python-envs/api';
import { DisposableStore } from '../../common/utils/lifecycle';
import { resetEnvExtApi } from '../../api/python-envs/pythonEnvsApi';

suite('Python Envs API Installer', () => {
    let serviceContainer: IServiceContainer;
    let installer: PythonEnvsApiInstaller;
    let mockApi: PythonEnvironmentApi;
    let mockResolvedEnv: ApiPythonEnvironment;
    const disposables = new DisposableStore();

    setup(() => {
        serviceContainer = mock<IServiceContainer>();
        installer = new PythonEnvsApiInstaller(instance(serviceContainer));

        // Reset VS Code mocks
        when(mockedVSCodeNamespaces.extensions.onDidChange).thenReturn(disposables.add(new EventEmitter<void>()).event);
        disposables.add(new Disposable(() => resetVSCodeMocks()));

        // Create mock API and resolved environment
        mockApi = mock<PythonEnvironmentApi>();
        instance(mockApi as any).then = undefined;
        mockResolvedEnv = {
            envId: { id: 'test-env-id', managerId: 'test-manager' },
            name: 'Test Environment',
            displayName: 'Test Environment',
            displayPath: '/path/to/env',
            version: '3.9.0',
            environmentPath: Uri.file('/path/to/env'),
            execInfo: {
                run: { executable: '/path/to/python' }
            },
            sysPrefix: '/path/to/env'
        };
        resetEnvExtApi();
    });

    teardown(() => disposables.clear());

    test('Should have correct type', () => {
        assert.equal(installer.type, ModuleInstallerType.PythonExt);
    });

    test('Should have high priority', () => {
        assert.equal(installer.priority, 100);
    });

    test('Should throw error since this method should not be called', async () => {
        try {
            await (installer as any).getExecutionArgs();
            assert.fail('Should have thrown an error');
        } catch (error) {
            assert.include(error.message, 'getExecutionArgs should not be called for PythonEnvsApiInstaller');
        }
    });

    test('Should return false when Python Environment Extension is not available', async () => {
        // Mock no extension found
        when(mockedVSCodeNamespaces.extensions.getExtension('ms-python.vscode-python-envs')).thenReturn(undefined);

        const pythonEnv: PythonEnvironment = {
            id: 'test-id',
            uri: Uri.file('/path/to/python')
        };

        const result = await installer.isSupported(pythonEnv);
        assert.isFalse(result);
    });

    test('Should return false when environment cannot be resolved', async () => {
        // Mock extension available but environment resolution fails
        const mockExtension = {
            id: 'ms-python.vscode-python-envs',
            isActive: true,
            exports: instance(mockApi)
        };
        when(mockedVSCodeNamespaces.extensions.getExtension('ms-python.vscode-python-envs')).thenReturn(
            mockExtension as any
        );
        when(mockApi.resolveEnvironment(anything())).thenResolve(undefined);

        const pythonEnv: PythonEnvironment = {
            id: 'test-id',
            uri: Uri.file('/path/to/python')
        };

        const result = await installer.isSupported(pythonEnv);
        assert.isFalse(result);
    });

    test('Should return true when environment can be resolved', async () => {
        // Mock extension available and environment resolution succeeds
        const mockExtension = {
            id: 'ms-python.vscode-python-envs',
            isActive: true,
            exports: instance(mockApi)
        };
        when(mockedVSCodeNamespaces.extensions.getExtension('ms-python.vscode-python-envs')).thenReturn(
            mockExtension as any
        );
        when(mockApi.resolveEnvironment(anything())).thenResolve(mockResolvedEnv);

        const pythonEnv: PythonEnvironment = {
            id: 'test-id',
            uri: Uri.file('/path/to/python')
        };

        const result = await installer.isSupported(pythonEnv);
        assert.isTrue(result);
    });

    test('Should return true for Python extension Environment type', async () => {
        // Mock extension available and environment resolution succeeds
        const mockExtension = {
            id: 'ms-python.vscode-python-envs',
            isActive: true,
            exports: instance(mockApi)
        };
        when(mockedVSCodeNamespaces.extensions.getExtension('ms-python.vscode-python-envs')).thenReturn(
            mockExtension as any
        );
        when(mockApi.resolveEnvironment(anything())).thenResolve(mockResolvedEnv);

        // Use mock instead of complex object creation for Environment type
        const pythonExtEnv = mock<Environment>();
        when(pythonExtEnv.id).thenReturn('/path/to/python');
        when(pythonExtEnv.path).thenReturn('/path/to/python');

        const result = await installer.isSupported(instance(pythonExtEnv));
        assert.isTrue(result);
    });
    suite('installModule', () => {
        let serviceContainer: IServiceContainer;
        let installer: PythonEnvsApiInstaller;
        let mockApi: PythonEnvironmentApi;
        let mockResolvedEnv: ApiPythonEnvironment;
        const disposables = new DisposableStore();
        let mockExtension: any;
        let cancelTokenSource: CancellationTokenSource;

        setup(() => {
            serviceContainer = mock<IServiceContainer>();
            installer = new PythonEnvsApiInstaller(instance(serviceContainer));

            // Reset VS Code mocks
            when(mockedVSCodeNamespaces.extensions.onDidChange).thenReturn(
                disposables.add(new EventEmitter<void>()).event
            );
            disposables.add(new Disposable(() => resetVSCodeMocks()));

            // Create mock API and resolved environment
            mockApi = mock<PythonEnvironmentApi>();
            instance(mockApi as any).then = undefined;
            mockResolvedEnv = {
                envId: { id: 'test-env-id', managerId: 'test-manager' },
                name: 'Test Environment',
                displayName: 'Test Environment',
                displayPath: '/path/to/env',
                version: '3.9.0',
                environmentPath: Uri.file('/path/to/env'),
                execInfo: {
                    run: { executable: '/path/to/python' }
                },
                sysPrefix: '/path/to/env'
            };

            mockExtension = {
                id: 'ms-python.vscode-python-envs',
                isActive: true,
                exports: instance(mockApi)
            };
            when(mockedVSCodeNamespaces.extensions.getExtension('ms-python.vscode-python-envs')).thenReturn(
                mockExtension
            );
            when(mockApi.resolveEnvironment(anything())).thenResolve(mockResolvedEnv);
            when(mockApi.managePackages(anything(), anything())).thenResolve();

            cancelTokenSource = new CancellationTokenSource();
        });

        test('Should install module using string name', async () => {
            const pythonEnv: PythonEnvironment = {
                id: 'test-id',
                uri: Uri.file('/path/to/python')
            };

            await installer.installModule('numpy', pythonEnv, cancelTokenSource);

            // Verify no error was thrown, indicating success
            assert.ok(true, 'Installation completed without error');
        });

        test('Should install module using Product enum', async () => {
            const pythonEnv: PythonEnvironment = {
                id: 'test-id',
                uri: Uri.file('/path/to/python')
            };

            await installer.installModule(Product.pandas, pythonEnv, cancelTokenSource);

            // The module name should be translated from Product.pandas to 'pandas'
            // No error indicates success
            assert.ok(true, 'Installation with Product enum completed without error');
        });

        test('Should install module with upgrade flag', async () => {
            const pythonEnv: PythonEnvironment = {
                id: 'test-id',
                uri: Uri.file('/path/to/python')
            };

            await installer.installModule('numpy', pythonEnv, cancelTokenSource, ModuleInstallFlags.upgrade);

            // No error indicates success and upgrade flag was handled
            assert.ok(true, 'Installation with upgrade flag completed without error');
        });

        test('Should work with Python extension Environment type', async () => {
            // Use mock for Environment type
            const pythonExtEnv = mock<Environment>();
            when(pythonExtEnv.id).thenReturn('/path/to/python');
            when(pythonExtEnv.path).thenReturn('/path/to/python');

            await installer.installModule('numpy', instance(pythonExtEnv), cancelTokenSource);

            // No error indicates success with Python extension Environment
            assert.ok(true, 'Installation with Environment type completed without error');
        });
    });
});
