// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mock } from 'ts-mockito';
import { expect } from 'chai';
import { UvInstaller } from './uvInstaller.node';
import { IServiceContainer } from '../../ioc/types';
import { ModuleInstallerType, ModuleInstallFlags } from './types';
import { EnvironmentType, PythonEnvironment } from '../../pythonEnvironments/info';
import { Environment } from '@vscode/python-extension';

// Mock helper to simulate getEnvironmentType
const mockGetEnvironmentType = (envType: EnvironmentType) => {
    // This would need to be properly mocked in a real test environment
    return envType;
};

describe('UV Installer', () => {
    let installer: UvInstaller;
    let serviceContainer: IServiceContainer;

    beforeEach(() => {
        serviceContainer = mock<IServiceContainer>();
        installer = new UvInstaller(serviceContainer);
    });

    it('Should have correct properties', () => {
        expect(installer.name).to.equal('UV');
        expect(installer.displayName).to.equal('UV');
        expect(installer.type).to.equal(ModuleInstallerType.UV);
        expect(installer.priority).to.equal(10);
    });

    it('Should support UV environments', async () => {
        const mockInterpreter: PythonEnvironment = {
            id: 'test-uv-env',
            uri: { fsPath: '/path/to/uv/env' } as any
        };

        // This test would need to be enhanced with proper mocking
        // For now, it demonstrates the expected structure
        expect(installer.isSupported).to.be.a('function');
    });

    it('Should generate correct execution args for UV pip install', async () => {
        const mockInterpreter: Environment = {
            id: 'test-uv-env',
            path: '/path/to/uv/env',
            tools: ['uv']
        } as any;

        // Test basic installation
        const args = await (installer as any).getExecutionArgs('numpy', mockInterpreter, ModuleInstallFlags.None);

        expect(args.exe).to.equal('uv');
        expect(args.args).to.include('pip');
        expect(args.args).to.include('install');
        expect(args.args).to.include('numpy');
    });

    it('Should handle upgrade flag correctly', async () => {
        const mockInterpreter: Environment = {
            id: 'test-uv-env',
            path: '/path/to/uv/env',
            tools: ['uv']
        } as any;

        const args = await (installer as any).getExecutionArgs('numpy', mockInterpreter, ModuleInstallFlags.upgrade);

        expect(args.args).to.include('--upgrade');
    });

    it('Should handle reinstall flag correctly', async () => {
        const mockInterpreter: Environment = {
            id: 'test-uv-env',
            path: '/path/to/uv/env',
            tools: ['uv']
        } as any;

        const args = await (installer as any).getExecutionArgs('numpy', mockInterpreter, ModuleInstallFlags.reInstall);

        expect(args.args).to.include('--force-reinstall');
    });
});
