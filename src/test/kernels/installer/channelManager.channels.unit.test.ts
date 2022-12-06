// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import assert from 'assert';
import { Container } from 'inversify';
import * as TypeMoq from 'typemoq';
import { IApplicationShell } from '../../../platform/common/application/types';
import { ServiceContainer } from '../../../platform/ioc/container';
import { ServiceManager } from '../../../platform/ioc/serviceManager';
import { IServiceContainer } from '../../../platform/ioc/types';
import { EnvironmentType, PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { InstallationChannelManager } from '../../../kernels/installer/channelManager.node';
import { Product, IModuleInstaller } from '../../../kernels/installer/types';
import { Uri } from 'vscode';

suite('Installation - installation channels', () => {
    let serviceManager: ServiceManager;
    let serviceContainer: IServiceContainer;
    const interpreter: PythonEnvironment = {
        envType: EnvironmentType.Conda,
        uri: Uri.file('foobar'),
        id: Uri.file('foobar').fsPath,
        sysPrefix: '0'
    };

    setup(() => {
        const cont = new Container();
        serviceManager = new ServiceManager(cont);
        serviceContainer = new ServiceContainer(cont);
    });

    test('Single channel', async () => {
        const installer = mockInstaller(true, '');
        const cm = new InstallationChannelManager(serviceContainer);
        const channels = await cm.getInstallationChannels(interpreter);
        assert.strictEqual(channels.length, 1, 'Incorrect number of channels');
        assert.strictEqual(channels[0], installer.object, 'Incorrect installer');
    });

    test('Multiple channels', async () => {
        const installer1 = mockInstaller(true, '1');
        mockInstaller(false, '2');
        const installer3 = mockInstaller(true, '3');

        const cm = new InstallationChannelManager(serviceContainer);
        const channels = await cm.getInstallationChannels(interpreter);
        assert.strictEqual(channels.length, 2, 'Incorrect number of channels');
        assert.strictEqual(channels[0], installer1.object, 'Incorrect installer 1');
        assert.strictEqual(channels[1], installer3.object, 'Incorrect installer 2');
    });

    test('pipenv channel', async () => {
        mockInstaller(true, '1');
        mockInstaller(false, '2');
        mockInstaller(true, '3');
        const pipenvInstaller = mockInstaller(true, 'pipenv', 10);

        const cm = new InstallationChannelManager(serviceContainer);
        const channels = await cm.getInstallationChannels(interpreter);
        assert.strictEqual(channels.length, 1, 'Incorrect number of channels');
        assert.strictEqual(channels[0], pipenvInstaller.object, 'Installer must be pipenv');
    });

    test('Select installer should not happen', async () => {
        const installer1 = mockInstaller(true, '1');
        const installer2 = mockInstaller(true, '2');

        const appShell = TypeMoq.Mock.ofType<IApplicationShell>();
        serviceManager.addSingletonInstance<IApplicationShell>(IApplicationShell, appShell.object);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let items: any[] | undefined;
        appShell
            .setup((x) => x.showQuickPick(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .callback((i: string[]) => {
                items = i;
            })
            .returns(() => new Promise<string | undefined>((resolve, _reject) => resolve(undefined)));

        installer1.setup((x) => x.displayName).returns(() => 'Name 1');
        installer2.setup((x) => x.displayName).returns(() => 'Name 2');
        installer1.setup((x) => (x as any).then).returns(() => undefined);
        installer2.setup((x) => (x as any).then).returns(() => undefined);

        const cm = new InstallationChannelManager(serviceContainer);
        const result = await cm.getInstallationChannel(Product.ensurepip, interpreter);

        assert.strictEqual(items, undefined, 'showQuickPick called');
        assert.strictEqual(result, installer1.object);
    });

    function mockInstaller(supported: boolean, name: string, priority?: number): TypeMoq.IMock<IModuleInstaller> {
        const installer = TypeMoq.Mock.ofType<IModuleInstaller>();
        installer
            .setup((x) => x.isSupported(TypeMoq.It.isAny()))
            .returns(() => new Promise<boolean>((resolve) => resolve(supported)));
        installer.setup((x) => x.priority).returns(() => priority || 0);
        serviceManager.addSingletonInstance<IModuleInstaller>(IModuleInstaller, installer.object, name);
        return installer;
    }
});
