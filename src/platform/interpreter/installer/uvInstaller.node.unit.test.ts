// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { anything, instance, mock, when } from 'ts-mockito';
import * as sinon from 'sinon';
import { UvInstaller } from './uvInstaller.node';
import { IServiceContainer } from '../../ioc/types';
import { IProcessServiceFactory, IProcessService } from '../../common/process/types.node';
import { ModuleInstallerType, ModuleInstallFlags } from './types';
import { ExecutionInstallArgs } from './moduleInstaller.node';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { Environment } from '@vscode/python-extension';
import * as helpers from '../helpers';
import { Uri } from 'vscode';

// Test class to access protected methods
class TestableUvInstaller extends UvInstaller {
    public async testGetExecutionArgs(
        moduleName: string,
        interpreter: PythonEnvironment | Environment,
        flags?: ModuleInstallFlags
    ): Promise<ExecutionInstallArgs> {
        return this.getExecutionArgs(moduleName, interpreter, flags);
    }
}

suite('UvInstaller', () => {
    let installer: UvInstaller;
    let testableInstaller: TestableUvInstaller;
    let serviceContainer: IServiceContainer;
    let processServiceFactory: IProcessServiceFactory;
    let processService: IProcessService;
    let getInterpreterInfoStub: sinon.SinonStub;

    setup(() => {
        serviceContainer = mock<IServiceContainer>();
        processServiceFactory = mock<IProcessServiceFactory>();
        processService = mock<IProcessService>();

        // Create stub for getInterpreterInfo helper
        getInterpreterInfoStub = sinon.stub(helpers, 'getInterpreterInfo');

        when(processServiceFactory.create(anything())).thenResolve(instance(processService));

        installer = new UvInstaller(instance(serviceContainer), instance(processServiceFactory));

        testableInstaller = new TestableUvInstaller(instance(serviceContainer), instance(processServiceFactory));

        // Ensure 'then' is undefined to prevent hanging tests
        (instance(processService) as any).then = undefined;
        (instance(processServiceFactory) as any).then = undefined;
        (instance(serviceContainer) as any).then = undefined;
    });

    teardown(() => {
        sinon.restore();
    });

    suite('Basic Properties', () => {
        test('Should return correct type', () => {
            assert.equal(installer.type, ModuleInstallerType.UV);
        });

        test('Should return correct priority', () => {
            assert.equal(installer.priority, 200);
        });
    });

    suite('getExecutionArgs', () => {
        const mockPythonEnvironment = {
            uri: Uri.file('/path/to/python'),
            id: 'test-env',
            path: '/path/to/python'
        } as unknown as PythonEnvironment;

        const mockExtensionEnvironment = {
            id: 'test-env',
            path: '/path/to/python'
        } as unknown as Environment;

        const mockInterpreterInfo = {
            uri: Uri.file('/path/to/python'),
            id: 'test-env',
            path: '/path/to/python',
            executable: {
                uri: Uri.file('/path/to/python'),
                bitness: '64-bit' as const,
                sysPrefix: '/path/to/prefix'
            }
        } as unknown as PythonEnvironment;

        test('Should generate correct arguments for basic install', async () => {
            getInterpreterInfoStub.resolves(mockInterpreterInfo);

            const result = await testableInstaller.testGetExecutionArgs('jupyter', mockPythonEnvironment);

            assert.equal(result.exe, 'uv');
            assert.deepEqual(result.args, [
                'pip',
                'install',
                '--python',
                Uri.file('/path/to/python').fsPath,
                'jupyter'
            ]);
        });

        test('Should generate correct arguments with upgrade flag', async () => {
            getInterpreterInfoStub.resolves(mockInterpreterInfo);

            const result = await testableInstaller.testGetExecutionArgs(
                'jupyter',
                mockPythonEnvironment,
                ModuleInstallFlags.upgrade
            );

            assert.equal(result.exe, 'uv');
            assert.deepEqual(result.args, [
                'pip',
                'install',
                '--upgrade',
                '--python',
                Uri.file('/path/to/python').fsPath,
                'jupyter'
            ]);
        });

        test('Should use path when executable.uri is not available', async () => {
            const envWithoutUri = {
                ...mockInterpreterInfo,
                executable: {
                    uri: undefined,
                    bitness: '64-bit' as const,
                    sysPrefix: '/path/to/prefix'
                }
            } as unknown as PythonEnvironment;
            getInterpreterInfoStub.resolves(envWithoutUri);

            const result = await testableInstaller.testGetExecutionArgs('jupyter', mockPythonEnvironment);

            assert.equal(result.exe, 'uv');
            assert.deepEqual(result.args, [
                'pip',
                'install',
                '--python',
                Uri.file('/path/to/python').fsPath,
                'jupyter'
            ]);
        });

        test('Should work with Extension Environment type', async () => {
            const mockEnvInfo = {
                uri: Uri.file('/extension/path/to/python'),
                id: 'test-env',
                path: '/extension/path/to/python',
                executable: {
                    uri: Uri.file('/extension/path/to/python'),
                    bitness: '64-bit' as const,
                    sysPrefix: '/path/to/prefix'
                }
            } as unknown as PythonEnvironment;
            getInterpreterInfoStub.resolves(mockEnvInfo);

            const result = await testableInstaller.testGetExecutionArgs('numpy', mockExtensionEnvironment);

            assert.equal(result.exe, 'uv');
            assert.deepEqual(result.args, [
                'pip',
                'install',
                '--python',
                Uri.file('/extension/path/to/python').fsPath,
                'numpy'
            ]);
        });

        test('Should throw error when interpreter info is not available', async () => {
            getInterpreterInfoStub.resolves(undefined);

            try {
                await testableInstaller.testGetExecutionArgs('jupyter', mockPythonEnvironment);
                assert.fail('Expected error to be thrown');
            } catch (error) {
                assert.include((error as Error).message, 'Unable to get interpreter information');
            }
        });
    });

    suite('Error Handling', () => {
        const mockPythonEnvironment = {
            uri: Uri.file('/path/to/python'),
            id: 'test-env',
            path: '/path/to/python'
        } as unknown as PythonEnvironment;

        const mockInterpreterInfo = {
            uri: Uri.file('/path/to/python'),
            id: 'test-env',
            path: '/path/to/python',
            executable: {
                uri: Uri.file('/path/to/python'),
                bitness: '64-bit' as const,
                sysPrefix: '/path/to/prefix'
            }
        } as unknown as PythonEnvironment;

        test('Should handle UV version check errors gracefully', async () => {
            getInterpreterInfoStub.resolves(mockInterpreterInfo);
            when(processService.exec('uv', ['--version'], anything())).thenReject(new Error('Command failed'));

            const result = await installer.isSupported(mockPythonEnvironment);

            assert.isFalse(result);
        });

        test('Should handle empty UV version output', async () => {
            getInterpreterInfoStub.resolves(mockInterpreterInfo);
            when(processService.exec('uv', ['--version'], anything())).thenResolve({ stdout: '', stderr: '' });

            const result = await installer.isSupported(mockPythonEnvironment);

            assert.isFalse(result);
        });

        test('Should handle process service creation failure', async () => {
            getInterpreterInfoStub.resolves(mockInterpreterInfo);
            when(processServiceFactory.create(anything())).thenReject(new Error('Failed to create process service'));

            try {
                await installer.isSupported(mockPythonEnvironment);
                assert.fail('Expected error to be thrown');
            } catch (error) {
                assert.include((error as Error).message, 'Failed to create process service');
            }
        });
    });
});
