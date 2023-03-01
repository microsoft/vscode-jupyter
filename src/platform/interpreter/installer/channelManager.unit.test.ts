// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { assert, expect } from 'chai';
import * as sinon from 'sinon';
import * as TypeMoq from 'typemoq';
import { IApplicationShell } from '../../../platform/common/application/types';
import { IPlatformService } from '../../../platform/common/platform/types';
import { Installer } from '../../../platform/common/utils/localize';
import { IServiceContainer } from '../../../platform/ioc/types';
import { EnvironmentType, PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { InstallationChannelManager } from '../../../platform/interpreter/installer/channelManager.node';
import { IModuleInstaller, Product } from '../../../platform/interpreter/installer/types';
import { Uri } from 'vscode';

suite('InstallationChannelManager - getInstallationChannel()', () => {
    let serviceContainer: TypeMoq.IMock<IServiceContainer>;
    let appShell: TypeMoq.IMock<IApplicationShell>;

    let getInstallationChannels: sinon.SinonStub<any>;

    let showNoInstallersMessage: sinon.SinonStub<any>;
    const interpreter: PythonEnvironment = {
        envType: EnvironmentType.Unknown,
        uri: Uri.file('foobar'),
        id: Uri.file('foobar').fsPath,
        sysPrefix: '0'
    };
    let installChannelManager: InstallationChannelManager;

    setup(() => {
        serviceContainer = TypeMoq.Mock.ofType<IServiceContainer>();
        appShell = TypeMoq.Mock.ofType<IApplicationShell>();
        serviceContainer.setup((s) => s.get<IApplicationShell>(IApplicationShell)).returns(() => appShell.object);
    });

    teardown(() => {
        sinon.restore();
    });

    test('If there is exactly one installation channel, return it', async () => {
        const moduleInstaller = TypeMoq.Mock.ofType<IModuleInstaller>();
        moduleInstaller.setup((m) => m.name).returns(() => 'singleChannel');
        moduleInstaller.setup((m) => (m as any).then).returns(() => undefined);
        getInstallationChannels = sinon.stub(InstallationChannelManager.prototype, 'getInstallationChannels');
        getInstallationChannels.resolves([moduleInstaller.object]);
        showNoInstallersMessage = sinon.stub(InstallationChannelManager.prototype, 'showNoInstallersMessage');
        showNoInstallersMessage.resolves();
        installChannelManager = new InstallationChannelManager(serviceContainer.object);

        const channel = await installChannelManager.getInstallationChannel(undefined as any, interpreter);
        expect(channel).to.not.equal(undefined, 'Channel should be set');
        expect(channel!.name).to.equal('singleChannel');
    });

    test('If no channels are returned by the resource, show no installer message and return', async () => {
        getInstallationChannels = sinon.stub(InstallationChannelManager.prototype, 'getInstallationChannels');
        getInstallationChannels.resolves([]);
        showNoInstallersMessage = sinon.stub(InstallationChannelManager.prototype, 'showNoInstallersMessage');
        showNoInstallersMessage.resolves();
        installChannelManager = new InstallationChannelManager(serviceContainer.object);

        const channel = await installChannelManager.getInstallationChannel(Product.jupyter, interpreter);
        expect(channel).to.equal(undefined, 'should be undefined');
        assert.ok(showNoInstallersMessage.calledOnceWith(interpreter));
    });

    test('If no channel is selected in the quickpick, return undefined', async () => {
        const moduleInstaller1 = TypeMoq.Mock.ofType<IModuleInstaller>();
        moduleInstaller1.setup((m) => m.displayName).returns(() => 'moduleInstaller1');
        moduleInstaller1.setup((m) => (m as any).then).returns(() => undefined);
        const moduleInstaller2 = TypeMoq.Mock.ofType<IModuleInstaller>();
        moduleInstaller2.setup((m) => m.displayName).returns(() => 'moduleInstaller2');
        moduleInstaller2.setup((m) => (m as any).then).returns(() => undefined);
        appShell
            .setup((a) => a.showQuickPick(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(undefined))
            .verifiable(TypeMoq.Times.never());
        getInstallationChannels = sinon.stub(InstallationChannelManager.prototype, 'getInstallationChannels');
        getInstallationChannels.resolves([moduleInstaller1.object, moduleInstaller2.object]);
        showNoInstallersMessage = sinon.stub(InstallationChannelManager.prototype, 'showNoInstallersMessage');
        showNoInstallersMessage.resolves();
        installChannelManager = new InstallationChannelManager(serviceContainer.object);

        const channel = await installChannelManager.getInstallationChannel(Product.jupyter, interpreter);
        assert.ok(showNoInstallersMessage.notCalled);
        appShell.verifyAll();
        expect(channel).to.equal(moduleInstaller1.object, 'Channel should be set');
    });
});

suite('InstallationChannelManager - getInstallationChannels()', () => {
    let serviceContainer: TypeMoq.IMock<IServiceContainer>;
    const interpreter: PythonEnvironment = {
        envType: EnvironmentType.Unknown,
        uri: Uri.file('foobar'),
        id: Uri.file('foobar').fsPath,
        sysPrefix: '0'
    };

    let installChannelManager: InstallationChannelManager;

    setup(() => {
        serviceContainer = TypeMoq.Mock.ofType<IServiceContainer>();
    });

    test('If no installers are returned by serviceContainer, return an empty list', async () => {
        serviceContainer.setup((s) => s.getAll<IModuleInstaller>(IModuleInstaller)).returns(() => []);
        installChannelManager = new InstallationChannelManager(serviceContainer.object);
        const channel = await installChannelManager.getInstallationChannels(interpreter);
        assert.deepEqual(channel, []);
    });

    test('Return highest priority supported installers', async () => {
        const moduleInstallers: IModuleInstaller[] = [];
        // Setup 2 installers with priority 1, where one is supported and other is not
        for (let i = 0; i < 2; i = i + 1) {
            const moduleInstaller = TypeMoq.Mock.ofType<IModuleInstaller>();
            moduleInstaller.setup((m) => (m as any).then).returns(() => undefined);
            moduleInstaller.setup((m) => m.priority).returns(() => 1);
            moduleInstaller.setup((m) => m.isSupported(interpreter)).returns(() => Promise.resolve(i % 2 === 0));
            moduleInstallers.push(moduleInstaller.object);
        }
        // Setup 3 installers with priority 2, where two are supported and other is not
        for (let i = 2; i < 5; i = i + 1) {
            const moduleInstaller = TypeMoq.Mock.ofType<IModuleInstaller>();
            moduleInstaller.setup((m) => (m as any).then).returns(() => undefined);
            moduleInstaller.setup((m) => m.priority).returns(() => 2);
            moduleInstaller.setup((m) => m.isSupported(interpreter)).returns(() => Promise.resolve(i % 2 === 0));
            moduleInstallers.push(moduleInstaller.object);
        }
        // Setup 2 installers with priority 3, but none are supported
        for (let i = 5; i < 7; i = i + 1) {
            const moduleInstaller = TypeMoq.Mock.ofType<IModuleInstaller>();
            moduleInstaller.setup((m) => (m as any).then).returns(() => undefined);
            moduleInstaller.setup((m) => m.priority).returns(() => 3);
            moduleInstaller.setup((m) => m.isSupported(interpreter)).returns(() => Promise.resolve(false));
            moduleInstallers.push(moduleInstaller.object);
        }
        serviceContainer.setup((s) => s.getAll<IModuleInstaller>(IModuleInstaller)).returns(() => moduleInstallers);
        installChannelManager = new InstallationChannelManager(serviceContainer.object);
        const channels = await installChannelManager.getInstallationChannels(interpreter);
        // Verify that highest supported priority is 2, so number of installers supported with that priority is 2
        expect(channels.length).to.equal(2);
        for (let i = 0; i < 2; i = i + 1) {
            expect(channels[i].priority).to.equal(2);
        }
    });
});

suite('InstallationChannelManager - showNoInstallersMessage()', () => {
    let serviceContainer: TypeMoq.IMock<IServiceContainer>;
    let installChannelManager: InstallationChannelManager;
    let appShell = TypeMoq.Mock.ofType<IApplicationShell>();

    setup(() => {
        serviceContainer = TypeMoq.Mock.ofType<IServiceContainer>();
        appShell = TypeMoq.Mock.ofType<IApplicationShell>();
        serviceContainer.setup((s) => s.get<IApplicationShell>(IApplicationShell)).returns(() => appShell.object);
    });

    test('If active interpreter is Conda, show conda prompt', async () => {
        const activeInterpreter = {
            envType: EnvironmentType.Conda,
            uri: Uri.file('foobar'),
            id: Uri.file('foobar').fsPath,
            sysPrefix: ''
        };
        appShell
            .setup((a) =>
                a.showErrorMessage(Installer.noCondaOrPipInstaller, TypeMoq.It.isAny(), Installer.searchForHelp)
            )
            .verifiable(TypeMoq.Times.once());
        installChannelManager = new InstallationChannelManager(serviceContainer.object);
        await installChannelManager.showNoInstallersMessage(activeInterpreter);
        serviceContainer.verifyAll();
        appShell.verifyAll();
    });

    test('If active interpreter is not Conda, show pip prompt', async () => {
        const activeInterpreter = {
            envType: EnvironmentType.Pipenv,
            uri: Uri.file('foobar'),
            id: Uri.file('foobar').fsPath,
            sysPrefix: ''
        };
        appShell
            .setup((a) => a.showErrorMessage(Installer.noPipInstaller, TypeMoq.It.isAny(), Installer.searchForHelp))
            .verifiable(TypeMoq.Times.once());
        installChannelManager = new InstallationChannelManager(serviceContainer.object);
        await installChannelManager.showNoInstallersMessage(activeInterpreter);
        serviceContainer.verifyAll();
        appShell.verifyAll();
    });

    [EnvironmentType.Conda, EnvironmentType.Pipenv].forEach((interpreterType) => {
        [
            {
                osName: 'Windows',
                isWindows: true,
                isMac: false
            },
            {
                osName: 'Linux',
                isWindows: false,
                isMac: false
            },
            {
                osName: 'MacOS',
                isWindows: false,
                isMac: true
            }
        ].forEach((testParams) => {
            const expectedURL = `https://www.bing.com/search?q=Install Pip ${testParams.osName} ${
                interpreterType === EnvironmentType.Conda ? 'Conda' : ''
            }`;
            test(`If \'Search for help\' is selected in error prompt, open correct URL for ${
                testParams.osName
            } when Interpreter type is ${
                interpreterType === EnvironmentType.Conda ? 'Conda' : 'not Conda'
            }`, async () => {
                const activeInterpreter = {
                    envType: interpreterType,
                    uri: Uri.file('foobar'),
                    id: Uri.file('foobar').fsPath,
                    sysPrefix: ''
                };
                const platformService = TypeMoq.Mock.ofType<IPlatformService>();
                serviceContainer
                    .setup((s) => s.get<IPlatformService>(IPlatformService))
                    .returns(() => platformService.object)
                    .verifiable(TypeMoq.Times.once());
                platformService.setup((p) => p.isWindows).returns(() => testParams.isWindows);
                platformService.setup((p) => p.isMac).returns(() => testParams.isMac);
                appShell
                    .setup((a) => a.showErrorMessage(TypeMoq.It.isAny(), TypeMoq.It.isAny(), Installer.searchForHelp))
                    .returns(() => Promise.resolve(Installer.searchForHelp))
                    .verifiable(TypeMoq.Times.once());
                appShell
                    .setup((a) => a.openUrl(expectedURL))
                    .returns(() => undefined)
                    .verifiable(TypeMoq.Times.once());
                installChannelManager = new InstallationChannelManager(serviceContainer.object);
                await installChannelManager.showNoInstallersMessage(activeInterpreter);
                serviceContainer.verifyAll();
                appShell.verifyAll();
            });
        });
    });
    test("If 'Search for help' is not selected in error prompt, don't open URL", async () => {
        const activeInterpreter = {
            envType: EnvironmentType.Conda,
            uri: Uri.file('foobar'),
            id: Uri.file('foobar').fsPath,
            sysPrefix: ''
        };
        const platformService = TypeMoq.Mock.ofType<IPlatformService>();
        serviceContainer
            .setup((s) => s.get<IPlatformService>(IPlatformService))
            .returns(() => platformService.object)
            .verifiable(TypeMoq.Times.never());
        platformService.setup((p) => p.isWindows).returns(() => true);
        appShell
            .setup((a) => a.showErrorMessage(TypeMoq.It.isAnyString(), TypeMoq.It.isAny(), Installer.searchForHelp))
            .returns(() => Promise.resolve(undefined))
            .verifiable(TypeMoq.Times.once());
        appShell
            .setup((a) => a.openUrl(TypeMoq.It.isAny()))
            .returns(() => undefined)
            .verifiable(TypeMoq.Times.never());
        installChannelManager = new InstallationChannelManager(serviceContainer.object);
        await installChannelManager.showNoInstallersMessage(activeInterpreter);
        serviceContainer.verifyAll();
        appShell.verifyAll();
    });
});
