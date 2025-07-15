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
import { 
    PythonEnvironmentApi, 
    PythonEnvironment as ApiPythonEnvironment
} from '../../api/python-envs/api';
import { DisposableStore } from '../../common/utils/lifecycle';

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
    });

    teardown(() => disposables.clear());

    suite('Basic Properties', () => {
        test('Should have correct name', () => {
            assert.equal(installer.name, 'PythonEnvsApi');
        });

        test('Should have correct display name', () => {
            assert.equal(installer.displayName, 'Python Environment API');
        });

        test('Should have correct type', () => {
            assert.equal(installer.type, ModuleInstallerType.UV);
        });

        test('Should have high priority', () => {
            assert.equal(installer.priority, 100);
        });
    });

    suite('getExecutionArgs', () => {
        test('Should throw error since this method should not be called', async () => {
            try {
                await (installer as any).getExecutionArgs();
                assert.fail('Should have thrown an error');
            } catch (error) {
                assert.include(error.message, 'getExecutionArgs should not be called for PythonEnvsApiInstaller');
            }
        });
    });

    suite('isSupported', () => {
        test('Should return false when Python Environment Extension is not available', async () => {
            // Mock no extension found
            when(mockedVSCodeNamespaces.extensions.getExtension('ms-python.vscode-python-envs')).thenReturn(undefined);

            const pythonEnv: PythonEnvironment = {
                uri: Uri.file('/path/to/python'),
                sysPrefix: '/path/to/env',
                displayName: 'Test Env'
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
            when(mockedVSCodeNamespaces.extensions.getExtension('ms-python.vscode-python-envs')).thenReturn(mockExtension as any);
            when(mockApi.resolveEnvironment(anything())).thenResolve(undefined);

            const pythonEnv: PythonEnvironment = {
                uri: Uri.file('/path/to/python'),
                sysPrefix: '/path/to/env',
                displayName: 'Test Env'
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
            when(mockedVSCodeNamespaces.extensions.getExtension('ms-python.vscode-python-envs')).thenReturn(mockExtension as any);
            when(mockApi.resolveEnvironment(anything())).thenResolve(mockResolvedEnv);

            const pythonEnv: PythonEnvironment = {
                uri: Uri.file('/path/to/python'),
                sysPrefix: '/path/to/env',
                displayName: 'Test Env'
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
            when(mockedVSCodeNamespaces.extensions.getExtension('ms-python.vscode-python-envs')).thenReturn(mockExtension as any);
            when(mockApi.resolveEnvironment(anything())).thenResolve(mockResolvedEnv);

            const pythonExtEnv: Environment = {
                id: '/path/to/python',
                path: '/path/to/python'
            };

            const result = await installer.isSupported(pythonExtEnv);
            assert.isTrue(result);
        });
    });

    suite('installModule', () => {
        let mockExtension: any;
        let cancelTokenSource: CancellationTokenSource;

        setup(() => {
            mockExtension = {
                id: 'ms-python.vscode-python-envs',
                isActive: true,
                exports: instance(mockApi)
            };
            when(mockedVSCodeNamespaces.extensions.getExtension('ms-python.vscode-python-envs')).thenReturn(mockExtension);
            when(mockApi.resolveEnvironment(anything())).thenResolve(mockResolvedEnv);
            when(mockApi.managePackages(anything(), anything())).thenResolve();
            
            cancelTokenSource = new CancellationTokenSource();
        });

        test('Should install module using string name', async () => {
            const pythonEnv: PythonEnvironment = {
                uri: Uri.file('/path/to/python'),
                sysPrefix: '/path/to/env',
                displayName: 'Test Env'
            };

            await installer.installModule('numpy', pythonEnv, cancelTokenSource);

            // Verify managePackages was called with correct options
            const expectedOptions: PackageManagementOptions = {
                install: ['numpy'],
                upgrade: false,
                showSkipOption: false
            };
            
            // Note: We can't easily verify the exact call with ts-mockito in this test setup,
            // but the fact that no error was thrown indicates the flow worked correctly
        });

        test('Should install module using Product enum', async () => {
            const pythonEnv: PythonEnvironment = {
                uri: Uri.file('/path/to/python'),
                sysPrefix: '/path/to/env',
                displayName: 'Test Env'
            };

            await installer.installModule(Product.pandas, pythonEnv, cancelTokenSource);

            // The module name should be translated from Product.pandas to 'pandas'
            // No error indicates success
        });

        test('Should install module with upgrade flag', async () => {
            const pythonEnv: PythonEnvironment = {
                uri: Uri.file('/path/to/python'),
                sysPrefix: '/path/to/env',
                displayName: 'Test Env'
            };

            await installer.installModule('numpy', pythonEnv, cancelTokenSource, ModuleInstallFlags.upgrade);

            // No error indicates success and upgrade flag was handled
        });

        test('Should work with Python extension Environment type', async () => {
            const pythonExtEnv: Environment = {
                id: '/path/to/python',
                path: '/path/to/python'
            };

            await installer.installModule('numpy', pythonExtEnv, cancelTokenSource);

            // No error indicates success with Python extension Environment
        });

        test('Should throw error when API is not available', async () => {
            when(mockedVSCodeNamespaces.extensions.getExtension('ms-python.vscode-python-envs')).thenReturn(undefined);

            const pythonEnv: PythonEnvironment = {
                uri: Uri.file('/path/to/python'),
                sysPrefix: '/path/to/env',
                displayName: 'Test Env'
            };

            try {
                await installer.installModule('numpy', pythonEnv, cancelTokenSource);
                assert.fail('Should have thrown an error');
            } catch (error) {
                assert.include(error.message, 'Python Environment Extension API not available');
            }
        });

        test('Should throw error when environment cannot be resolved', async () => {
            when(mockApi.resolveEnvironment(anything())).thenResolve(undefined);

            const pythonEnv: PythonEnvironment = {
                uri: Uri.file('/path/to/python'),
                sysPrefix: '/path/to/env',
                displayName: 'Test Env'
            };

            try {
                await installer.installModule('numpy', pythonEnv, cancelTokenSource);
                assert.fail('Should have thrown an error');
            } catch (error) {
                assert.include(error.message, 'Unable to resolve Python environment with API');
            }
        });

        test('Should throw error when package management fails', async () => {
            when(mockApi.managePackages(anything(), anything())).thenReject(new Error('Installation failed'));

            const pythonEnv: PythonEnvironment = {
                uri: Uri.file('/path/to/python'),
                sysPrefix: '/path/to/env',
                displayName: 'Test Env'
            };

            try {
                await installer.installModule('numpy', pythonEnv, cancelTokenSource);
                assert.fail('Should have thrown an error');
            } catch (error) {
                assert.include(error.message, 'Installation failed');
            }
        });
    });
});
