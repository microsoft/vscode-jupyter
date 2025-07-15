// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { assert, expect } from 'chai';
import { IServiceContainer } from '../../../platform/ioc/types';
import { EnvironmentType, PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { UvInstaller } from '../../../platform/interpreter/installer/uvInstaller.node';
import { CancellationTokenSource, Uri } from 'vscode';
import { anything, instance, mock, when } from 'ts-mockito';
import { ModuleInstallerType, Product } from '../../../platform/interpreter/installer/types';
import { IDisposable } from '../../../platform/common/types';
import { PythonExtension, Environment } from '@vscode/python-extension';
import sinon from 'sinon';
import { resolvableInstance } from '../../../test/datascience/helpers';
import { setPythonApi } from '../helpers';

suite('UV installer', async () => {
    let serviceContainer: IServiceContainer;
    let uvInstaller: UvInstaller;
    let disposables: IDisposable[] = [];
    let environments: PythonExtension['environments'];
    
    setup(() => {
        serviceContainer = mock<IServiceContainer>();
        uvInstaller = new UvInstaller(instance(serviceContainer));
        
        // Mock Python API for environment detection
        environments = resolvableInstance(mock<PythonExtension['environments']>());
        const pythonApi = resolvableInstance(mock<PythonExtension>());
        when(pythonApi.environments).thenReturn(environments);
        setPythonApi(pythonApi);
    });

    teardown(() => {
        disposables.forEach((d) => d.dispose());
        disposables = [];
        sinon.restore();
    });

    test('Installer name is UV', () => {
        expect(uvInstaller.name).to.equal('UV');
    });

    test('Installer display name is UV', () => {
        expect(uvInstaller.displayName).to.equal('UV');
    });

    test('Installer type is UV', () => {
        expect(uvInstaller.type).to.equal(ModuleInstallerType.Uv);
    });

    test('Installer has low priority', () => {
        expect(uvInstaller.priority).to.equal(100);
    });

    test('isSupported returns false for non-UV environments', async () => {
        const interpreter: PythonEnvironment = {
            id: 'python-test',
            uri: Uri.file('/path/to/python')
        };

        // Mock environment that is not UV-managed
        const mockEnv: Environment = {
            id: 'python-test',
            path: '/path/to/python',
            tools: ['Venv'],
            environment: {
                folderUri: Uri.file('/path/to/project/.venv'),
                name: 'test-env'
            },
            executable: {
                uri: Uri.file('/path/to/python')
            }
        } as any;

        when(environments.known).thenReturn([mockEnv]);

        const isSupported = await uvInstaller.isSupported(interpreter);
        expect(isSupported).to.equal(false);
    });

    test('isSupported returns true for UV environments', async () => {
        const interpreter: PythonEnvironment = {
            id: 'python-test',
            uri: Uri.file('/path/to/project/.venv/bin/python')
        };

        // Mock environment that is UV-managed (contains .venv in path)
        const mockEnv: Environment = {
            id: 'python-test',
            path: '/path/to/project/.venv/bin/python',
            tools: ['Venv'],
            environment: {
                folderUri: Uri.file('/path/to/project/.venv'),
                name: 'test-env'
            },
            executable: {
                uri: Uri.file('/path/to/project/.venv/bin/python')
            }
        } as any;

        when(environments.known).thenReturn([mockEnv]);

        const isSupported = await uvInstaller.isSupported(interpreter);
        expect(isSupported).to.equal(true);
    });

    test('getExecutionArgs returns UV pip install command', async () => {
        const interpreter: PythonEnvironment = {
            id: 'python-test',
            uri: Uri.file('/path/to/python')
        };

        const args = await uvInstaller['getExecutionArgs']('ipykernel', interpreter);
        
        expect(args.exe).to.equal('uv');
        expect(args.args).to.include('pip');
        expect(args.args).to.include('install');
        expect(args.args).to.include('-U');
        expect(args.args).to.include('ipykernel');
    });
});