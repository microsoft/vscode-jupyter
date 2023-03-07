// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from 'assert';
import { SemVer } from 'semver';
import { IApplicationShell } from '../../../platform/common/application/types';
import { IPlatformService } from '../../../platform/common/platform/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { ServiceContainer } from '../../../platform/ioc/container';
import { IServiceContainer } from '../../../platform/ioc/types';
import { EnvironmentType, PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { InstallationChannelManager } from '../../../platform/interpreter/installer/channelManager.node';
import { IModuleInstaller, Product } from '../../../platform/interpreter/installer/types';
import { Uri } from 'vscode';
import { anything, instance, mock, when } from 'ts-mockito';

const info: PythonEnvironment = {
    displayName: '',
    envName: '',
    uri: Uri.file(''),
    id: Uri.file('').fsPath,
    envType: EnvironmentType.Unknown,
    version: new SemVer('0.0.0-alpha'),
    sysPrefix: '',
    sysVersion: ''
};

suite('Installation - channel messages', () => {
    let serviceContainer: IServiceContainer;
    let platform: IPlatformService;
    let appShell: IApplicationShell;
    let interpreters: IInterpreterService;
    let moduleInstaller: IModuleInstaller;

    setup(() => {
        serviceContainer = mock<ServiceContainer>();

        platform = mock<IPlatformService>();
        appShell = mock<IApplicationShell>();
        interpreters = mock<IInterpreterService>();
        moduleInstaller = mock<IModuleInstaller>();
        when(serviceContainer.get<IPlatformService>(IPlatformService)).thenReturn(instance(platform));
        when(serviceContainer.get<IApplicationShell>(IApplicationShell)).thenReturn(instance(appShell));
        when(serviceContainer.get<IInterpreterService>(IInterpreterService)).thenReturn(instance(interpreters));
        when(serviceContainer.getAll<IModuleInstaller>(IModuleInstaller)).thenReturn([instance(moduleInstaller)]);
    });

    test('No installers message: Unknown/Windows', async () => {
        when(platform.isWindows).thenReturn(true);
        await testInstallerMissingMessage(EnvironmentType.Unknown, async (message: string, url: string) => {
            verifyMessage(message, ['Pip'], ['Conda']);
            verifyUrl(url, ['Windows', 'Pip']);
        });
    });

    test('No installers message: Conda/Windows', async () => {
        when(platform.isWindows).thenReturn(true);
        await testInstallerMissingMessage(EnvironmentType.Conda, async (message: string, url: string) => {
            verifyMessage(message, ['Pip', 'Conda'], []);
            verifyUrl(url, ['Windows', 'Pip', 'Conda']);
        });
    });

    test('No installers message: Unknown/Mac', async () => {
        when(platform.isWindows).thenReturn(false);
        when(platform.isMac).thenReturn(true);
        await testInstallerMissingMessage(EnvironmentType.Unknown, async (message: string, url: string) => {
            verifyMessage(message, ['Pip'], ['Conda']);
            verifyUrl(url, ['Mac', 'Pip']);
        });
    });

    test('No installers message: Conda/Mac', async () => {
        when(platform.isWindows).thenReturn(false);
        when(platform.isMac).thenReturn(true);
        await testInstallerMissingMessage(EnvironmentType.Conda, async (message: string, url: string) => {
            verifyMessage(message, ['Pip', 'Conda'], []);
            verifyUrl(url, ['Mac', 'Pip', 'Conda']);
        });
    });

    test('No installers message: Unknown/Linux', async () => {
        when(platform.isWindows).thenReturn(false);
        when(platform.isMac).thenReturn(false);
        when(platform.isLinux).thenReturn(true);
        await testInstallerMissingMessage(EnvironmentType.Unknown, async (message: string, url: string) => {
            verifyMessage(message, ['Pip'], ['Conda']);
            verifyUrl(url, ['Linux', 'Pip']);
        });
    });

    test('No installers message: Conda/Linux', async () => {
        when(platform.isWindows).thenReturn(false);
        when(platform.isMac).thenReturn(false);
        when(platform.isLinux).thenReturn(true);
        await testInstallerMissingMessage(EnvironmentType.Conda, async (message: string, url: string) => {
            verifyMessage(message, ['Pip', 'Conda'], []);
            verifyUrl(url, ['Linux', 'Pip', 'Conda']);
        });
    });

    test('No channels message', async () => {
        when(platform.isWindows).thenReturn(true);
        await testInstallerMissingMessage(
            EnvironmentType.Unknown,
            async (message: string, url: string) => {
                verifyMessage(message, ['Pip'], ['Conda']);
                verifyUrl(url, ['Windows', 'Pip']);
            },
            'getInstallationChannel'
        );
    });

    function verifyMessage(message: string, present: string[], missing: string[]) {
        for (const p of present) {
            assert.strictEqual(message.indexOf(p) >= 0, true, `Message '${message}' does not contain ${p}.`);
        }
        for (const m of missing) {
            assert.strictEqual(message.indexOf(m) < 0, true, `Message '${message}' incorrectly contains ${m}.`);
        }
    }

    function verifyUrl(url: string, terms: string[]) {
        assert.strictEqual(url.indexOf('https://') >= 0, true, 'Search Url must be https.');
        for (const term of terms) {
            assert.strictEqual(url.indexOf(term) >= 0, true, `Search Url does not contain ${term}.`);
        }
    }

    async function testInstallerMissingMessage(
        interpreterType: EnvironmentType,
        verify: (m: string, u: string) => Promise<void>,
        methodType: 'showNoInstallersMessage' | 'getInstallationChannel' = 'showNoInstallersMessage'
    ): Promise<void> {
        const activeInterpreter: PythonEnvironment = {
            ...info,
            envType: interpreterType,
            uri: Uri.file('')
        };
        when(interpreters.getActiveInterpreter(anything())).thenResolve(activeInterpreter);
        const channels = new InstallationChannelManager(instance(serviceContainer));

        let url = '';
        let message = '';
        let search = '';
        when(appShell.showErrorMessage(anything(), anything(), anything())).thenCall((m: string, _, s: string) => {
            message = m;
            search = s;
            return Promise.resolve(search);
        });
        when(appShell.showErrorMessage(anything(), anything())).thenCall((m: string, s: string) => {
            message = m;
            search = s;
            return Promise.resolve(search);
        });
        when(appShell.openUrl(anything())).thenCall((s: string) => {
            url = s;
        });
        if (methodType === 'showNoInstallersMessage') {
            await channels.showNoInstallersMessage(activeInterpreter);
        } else {
            await channels.getInstallationChannel(Product.jupyter, info);
        }
        await verify(message, url);
    }
});
