// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

'use strict';

import { expect } from 'chai';
import * as TypeMoq from 'typemoq';
import { CancellationTokenSource, Uri } from 'vscode';
import { IApplicationShell } from '../../../platform/common/application/types';
import { InterpreterUri, IOutputChannel } from '../../../platform/common/types';
import { IServiceContainer } from '../../../platform/ioc/types';
import { EnvironmentType, PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { DataScienceInstaller } from '../../../kernels/installer/productInstaller.node';
import {
    Product,
    IInstallationChannelManager,
    InstallerResponse,
    IModuleInstaller,
    ModuleInstallerType
} from '../../../kernels/installer/types';
import { sleep } from '../../core';

class AlwaysInstalledDataScienceInstaller extends DataScienceInstaller {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars, class-methods-use-this
    public override async isInstalled(_product: Product, _resource?: InterpreterUri): Promise<boolean> {
        return true;
    }
}

suite('DataScienceInstaller install', async () => {
    let serviceContainer: TypeMoq.IMock<IServiceContainer>;
    let installationChannelManager: TypeMoq.IMock<IInstallationChannelManager>;
    let dataScienceInstaller: DataScienceInstaller;
    let appShell: TypeMoq.IMock<IApplicationShell>;
    let outputChannel: TypeMoq.IMock<IOutputChannel>;
    let tokenSource: CancellationTokenSource;

    const interpreterPath = Uri.file('path/to/interpreter');

    setup(() => {
        tokenSource = new CancellationTokenSource();
        serviceContainer = TypeMoq.Mock.ofType<IServiceContainer>();
        installationChannelManager = TypeMoq.Mock.ofType<IInstallationChannelManager>();
        appShell = TypeMoq.Mock.ofType<IApplicationShell>();
        outputChannel = TypeMoq.Mock.ofType<IOutputChannel>();
        appShell.setup((a) => a.showErrorMessage(TypeMoq.It.isAnyString())).returns(() => Promise.resolve(undefined));
        serviceContainer
            .setup((c) => c.get(TypeMoq.It.isValue(IInstallationChannelManager)))
            .returns(() => installationChannelManager.object);

        serviceContainer.setup((c) => c.get(TypeMoq.It.isValue(IApplicationShell))).returns(() => appShell.object);

        dataScienceInstaller = new AlwaysInstalledDataScienceInstaller(serviceContainer.object, outputChannel.object);
    });

    teardown(() => {
        tokenSource.dispose();
    });

    test('Will ignore with no installer modules', async () => {
        const testEnvironment: PythonEnvironment = {
            envType: EnvironmentType.VirtualEnv,
            envName: 'test',
            envPath: interpreterPath,
            id: interpreterPath.fsPath,
            uri: interpreterPath,
            sysPrefix: ''
        };
        installationChannelManager
            .setup((c) => c.getInstallationChannels(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve([]));
        const result = await dataScienceInstaller.install(Product.ipykernel, testEnvironment, tokenSource);
        expect(result).to.equal(InstallerResponse.Ignore, 'Should be InstallerResponse.Ignore');
    });

    test('Will cancel when signaled', async () => {
        const testEnvironment: PythonEnvironment = {
            envType: EnvironmentType.VirtualEnv,
            envName: 'test',
            envPath: interpreterPath,
            id: interpreterPath.fsPath,
            uri: interpreterPath,
            sysPrefix: ''
        };
        const testInstaller = TypeMoq.Mock.ofType<IModuleInstaller>();
        testInstaller.setup((c) => c.type).returns(() => ModuleInstallerType.Conda);
        testInstaller
            .setup((c) =>
                c.installModule(
                    TypeMoq.It.isValue(Product.ipykernel),
                    TypeMoq.It.isValue(testEnvironment),
                    TypeMoq.It.isAny(),
                    TypeMoq.It.isAny()
                )
            )
            .returns(() => Promise.resolve());

        installationChannelManager
            .setup((c) => c.getInstallationChannels(TypeMoq.It.isAny()))
            .returns(() => sleep(5000).then(() => [testInstaller.object]));
        const resultPromise = dataScienceInstaller.install(Product.ipykernel, testEnvironment, tokenSource);
        tokenSource.cancel();
        const result = await resultPromise;
        expect(result).to.equal(InstallerResponse.Ignore, 'Should be InstallerResponse.Ignore');
    });

    test('Will invoke conda for conda environments', async () => {
        const testEnvironment: PythonEnvironment = {
            envType: EnvironmentType.Conda,
            envName: 'test',
            envPath: interpreterPath,
            id: interpreterPath.fsPath,
            uri: interpreterPath,
            sysPrefix: ''
        };
        const testInstaller = TypeMoq.Mock.ofType<IModuleInstaller>();
        testInstaller.setup((c) => c.type).returns(() => ModuleInstallerType.Conda);
        testInstaller
            .setup((c) =>
                c.installModule(
                    TypeMoq.It.isValue(Product.ipykernel),
                    TypeMoq.It.isValue(testEnvironment),
                    TypeMoq.It.isAny(),
                    TypeMoq.It.isAny()
                )
            )
            .returns(() => Promise.resolve());

        installationChannelManager
            .setup((c) => c.getInstallationChannel(TypeMoq.It.isAny(), TypeMoq.It.isValue(testEnvironment)))
            .returns(() => Promise.resolve(testInstaller.object));
        testInstaller.setup((p) => (p as any).then).returns(() => undefined);

        const result = await dataScienceInstaller.install(Product.ipykernel, testEnvironment, tokenSource);
        expect(result).to.equal(InstallerResponse.Installed, 'Should be Installed');
    });

    test('Will invoke pip by default', async () => {
        const testEnvironment: PythonEnvironment = {
            envType: EnvironmentType.VirtualEnv,
            envName: 'test',
            envPath: interpreterPath,
            uri: interpreterPath,
            id: interpreterPath.fsPath,
            sysPrefix: ''
        };
        const testInstaller = TypeMoq.Mock.ofType<IModuleInstaller>();

        testInstaller.setup((c) => c.type).returns(() => ModuleInstallerType.Pip);
        testInstaller
            .setup((c) =>
                c.installModule(
                    TypeMoq.It.isValue(Product.ipykernel),
                    TypeMoq.It.isValue(testEnvironment),
                    TypeMoq.It.isAny(),
                    TypeMoq.It.isAny()
                )
            )
            .returns(() => Promise.resolve());

        installationChannelManager
            .setup((c) => c.getInstallationChannel(TypeMoq.It.isAny(), TypeMoq.It.isValue(testEnvironment)))
            .returns(() => Promise.resolve(testInstaller.object));
        testInstaller.setup((p) => (p as any).then).returns(() => undefined);

        const result = await dataScienceInstaller.install(Product.ipykernel, testEnvironment, tokenSource);
        expect(result).to.equal(InstallerResponse.Installed, 'Should be Installed');
    });

    test('Will invoke poetry', async () => {
        const testEnvironment: PythonEnvironment = {
            envType: EnvironmentType.Poetry,
            envName: 'test',
            envPath: interpreterPath,
            id: interpreterPath.fsPath,
            uri: interpreterPath,
            sysPrefix: ''
        };
        const testInstaller = TypeMoq.Mock.ofType<IModuleInstaller>();

        testInstaller.setup((c) => c.type).returns(() => ModuleInstallerType.Poetry);
        testInstaller
            .setup((c) =>
                c.installModule(
                    TypeMoq.It.isValue(Product.ipykernel),
                    TypeMoq.It.isValue(testEnvironment),
                    TypeMoq.It.isAny(),
                    TypeMoq.It.isAny()
                )
            )
            .returns(() => Promise.resolve());

        installationChannelManager
            .setup((c) => c.getInstallationChannel(TypeMoq.It.isAny(), TypeMoq.It.isValue(testEnvironment)))
            .returns(() => Promise.resolve(testInstaller.object));
        testInstaller.setup((p) => (p as any).then).returns(() => undefined);

        const result = await dataScienceInstaller.install(Product.ipykernel, testEnvironment, tokenSource);
        expect(result).to.equal(InstallerResponse.Installed, 'Should be Installed');
    });

    test('Will invoke pipenv', async () => {
        const testEnvironment: PythonEnvironment = {
            envType: EnvironmentType.Pipenv,
            envName: 'test',
            envPath: interpreterPath,
            id: interpreterPath.fsPath,
            uri: interpreterPath,
            sysPrefix: ''
        };
        const testInstaller = TypeMoq.Mock.ofType<IModuleInstaller>();

        testInstaller.setup((c) => c.type).returns(() => ModuleInstallerType.Pipenv);
        testInstaller
            .setup((c) =>
                c.installModule(
                    TypeMoq.It.isValue(Product.ipykernel),
                    TypeMoq.It.isValue(testEnvironment),
                    TypeMoq.It.isAny(),
                    TypeMoq.It.isAny()
                )
            )
            .returns(() => Promise.resolve());

        installationChannelManager
            .setup((c) => c.getInstallationChannel(TypeMoq.It.isAny(), TypeMoq.It.isValue(testEnvironment)))
            .returns(() => Promise.resolve(testInstaller.object));
        testInstaller.setup((p) => (p as any).then).returns(() => undefined);

        const result = await dataScienceInstaller.install(Product.ipykernel, testEnvironment, tokenSource);
        expect(result).to.equal(InstallerResponse.Installed, 'Should be Installed');
    });
});
