// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { expect } from 'chai';
import * as TypeMoq from 'typemoq';
import { CancellationTokenSource, Uri } from 'vscode';
import { InterpreterUri, IOutputChannel } from '../../../platform/common/types';
import { IServiceContainer } from '../../../platform/ioc/types';
import { EnvironmentType, PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { DataScienceInstaller } from '../../../platform/interpreter/installer/productInstaller.node';
import {
    Product,
    IInstallationChannelManager,
    InstallerResponse,
    IModuleInstaller,
    ModuleInstallerType
} from '../../../platform/interpreter/installer/types';
import { sleep } from '../../../test/core';
import { Environment } from '@vscode/python-extension';
import { anything, when } from 'ts-mockito';
import { mockedVSCodeNamespaces, resetVSCodeMocks } from '../../../test/vscode-mock';

class AlwaysInstalledDataScienceInstaller extends DataScienceInstaller {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars, class-methods-use-this
    public override async isInstalled(_product: Product, _resource?: InterpreterUri | Environment): Promise<boolean> {
        return true;
    }
}

suite('DataScienceInstaller install', async () => {
    let serviceContainer: TypeMoq.IMock<IServiceContainer>;
    let installationChannelManager: TypeMoq.IMock<IInstallationChannelManager>;
    let dataScienceInstaller: DataScienceInstaller;
    let outputChannel: TypeMoq.IMock<IOutputChannel>;
    let tokenSource: CancellationTokenSource;

    const interpreterPath = Uri.file('path/to/interpreter');

    setup(() => {
        resetVSCodeMocks();
        tokenSource = new CancellationTokenSource();
        serviceContainer = TypeMoq.Mock.ofType<IServiceContainer>();
        installationChannelManager = TypeMoq.Mock.ofType<IInstallationChannelManager>();
        outputChannel = TypeMoq.Mock.ofType<IOutputChannel>();
        when(mockedVSCodeNamespaces.window.showErrorMessage(anything())).thenResolve();
        serviceContainer
            .setup((c) => c.get(TypeMoq.It.isValue(IInstallationChannelManager)))
            .returns(() => installationChannelManager.object);

        dataScienceInstaller = new AlwaysInstalledDataScienceInstaller(serviceContainer.object, outputChannel.object);
    });

    teardown(() => {
        resetVSCodeMocks();
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
