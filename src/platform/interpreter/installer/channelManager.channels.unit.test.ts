// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import assert from 'assert';
import { ServiceContainer } from '../../ioc/container';
import { IServiceContainer } from '../../ioc/types';
import { EnvironmentType, PythonEnvironment } from '../../pythonEnvironments/info';
import { InstallationChannelManager } from './channelManager.node';
import { Product, IModuleInstaller } from './types';
import { Uri } from 'vscode';
import { anything, instance, mock, when } from 'ts-mockito';

suite('Installation - installation channels', () => {
    let serviceContainer: IServiceContainer;
    let cm: InstallationChannelManager;
    const interpreter: PythonEnvironment = {
        envType: EnvironmentType.Conda,
        uri: Uri.file('foobar'),
        id: Uri.file('foobar').fsPath,
        sysPrefix: '0'
    };

    setup(() => {
        serviceContainer = mock<ServiceContainer>();
        cm = new InstallationChannelManager(instance(serviceContainer));
    });

    test('Single channel', async () => {
        const installer = mockInstaller(true);
        when(serviceContainer.getAll(IModuleInstaller)).thenReturn([instance(installer)]);
        const channels = await cm.getInstallationChannels(interpreter);
        assert.strictEqual(channels.length, 1, 'Incorrect number of channels');
        assert.strictEqual(channels[0], instance(installer), 'Incorrect installer');
    });

    test('Multiple channels', async () => {
        const installer1 = mockInstaller(true);
        const installer2 = mockInstaller(true);
        when(serviceContainer.getAll(IModuleInstaller)).thenReturn([instance(installer1), instance(installer2)]);
        const channels = await cm.getInstallationChannels(interpreter);
        assert.strictEqual(channels.length, 2, 'Incorrect number of channels');
        assert.strictEqual(channels[0], instance(installer1), 'Incorrect installer 1');
        assert.strictEqual(channels[1], instance(installer2), 'Incorrect installer 2');
    });

    test('pipenv channel', async () => {
        const installer1 = mockInstaller(true);
        const installer2 = mockInstaller(false);
        const installer3 = mockInstaller(true);
        const pipenvInstaller = mockInstaller(true, 10);
        when(serviceContainer.getAll(IModuleInstaller)).thenReturn([
            instance(installer1),
            instance(installer2),
            instance(installer3),
            instance(pipenvInstaller)
        ]);

        const channels = await cm.getInstallationChannels(interpreter);
        assert.strictEqual(channels.length, 1, 'Incorrect number of channels');
        assert.strictEqual(channels[0], instance(pipenvInstaller), 'Installer must be pipenv');
    });

    test('Select installer should not happen', async () => {
        const installer1 = mockInstaller(true);
        const installer2 = mockInstaller(true);
        when(serviceContainer.getAll(IModuleInstaller)).thenReturn([instance(installer1), instance(installer2)]);
        when(installer1.displayName).thenReturn('Name 1');
        when(installer2.displayName).thenReturn('Name 2');
        (instance(installer1) as any).then = undefined;
        (instance(installer2) as any).then = undefined;

        const result = await cm.getInstallationChannel(Product.ensurepip, interpreter);

        assert.strictEqual(result, instance(installer1));
    });

    function mockInstaller(supported: boolean, priority?: number): IModuleInstaller {
        const installer = mock<IModuleInstaller>();
        (installer as any).then = undefined;
        when(installer.isSupported(anything())).thenResolve(supported);
        when(installer.priority).thenReturn(priority || 0);
        return installer;
    }
});
