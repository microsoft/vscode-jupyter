// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { assert } from 'chai';
import { instance, mock } from 'ts-mockito';
import { IServiceContainer } from '../../ioc/types';
import { PythonEnvsApiInstaller } from './pythonEnvsApiInstaller.node';
import { ModuleInstallerType } from './types';

suite('Python Envs API Installer', () => {
    let serviceContainer: IServiceContainer;
    let installer: PythonEnvsApiInstaller;

    setup(() => {
        serviceContainer = mock<IServiceContainer>();
        installer = new PythonEnvsApiInstaller(instance(serviceContainer));
    });

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
});
