// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from 'assert';
import { IPlatformService } from '../../../platform/common/platform/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { ServiceContainer } from '../../../platform/ioc/container';
import { IServiceContainer } from '../../../platform/ioc/types';
import { EnvironmentType, PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { InstallationChannelManager } from '../../../platform/interpreter/installer/channelManager.node';
import { IModuleInstaller, Product } from '../../../platform/interpreter/installer/types';
import { Uri } from 'vscode';
import { anything, instance, mock, when } from 'ts-mockito';
import { mockedVSCodeNamespaces } from '../../../test/vscode-mock';
import type { IDisposable } from '@c4312/evt';
import { PythonExtension } from '@vscode/python-extension';
import sinon from 'sinon';
import { resolvableInstance } from '../../../test/datascience/helpers';
import { dispose } from '../../common/utils/lifecycle';
import { setPythonApi } from '../helpers';

const info: PythonEnvironment = {
    displayName: '',
    envName: '',
    uri: Uri.file(''),
    id: Uri.file('').fsPath
};

suite('Installation - channel messages', () => {
    let disposables: IDisposable[] = [];
    let serviceContainer: IServiceContainer;
    let platform: IPlatformService;
    let interpreters: IInterpreterService;
    let moduleInstaller: IModuleInstaller;
    let environments: PythonExtension['environments'];
    setup(() => {
        serviceContainer = mock<ServiceContainer>();

        platform = mock<IPlatformService>();
        interpreters = mock<IInterpreterService>();
        moduleInstaller = mock<IModuleInstaller>();
        when(serviceContainer.get<IPlatformService>(IPlatformService)).thenReturn(instance(platform));
        when(serviceContainer.get<IInterpreterService>(IInterpreterService)).thenReturn(instance(interpreters));
        when(serviceContainer.getAll<IModuleInstaller>(IModuleInstaller)).thenReturn([instance(moduleInstaller)]);
        const mockedApi = mock<PythonExtension>();
        sinon.stub(PythonExtension, 'api').resolves(resolvableInstance(mockedApi));
        disposables.push({ dispose: () => sinon.restore() });
        environments = mock<PythonExtension['environments']>();
        when(mockedApi.environments).thenReturn(instance(environments));
        when(environments.known).thenReturn([]);
        setPythonApi(instance(mockedApi));
        disposables.push({ dispose: () => setPythonApi(undefined as any) });
    });
    teardown(() => (disposables = dispose(disposables)));

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
            uri: Uri.file('')
        };
        when(environments.known).thenReturn([
            {
                id: info.id,
                version: {
                    major: 3,
                    minor: 12,
                    micro: 7,
                    release: undefined,
                    sysVersion: '3.12.7'
                },
                tools: [interpreterType]
            } as any
        ]);
        when(interpreters.getActiveInterpreter(anything())).thenResolve(activeInterpreter);
        const channels = new InstallationChannelManager(instance(serviceContainer));

        let url = '';
        let message = '';
        let search = '';
        when(mockedVSCodeNamespaces.window.showErrorMessage(anything(), anything(), anything())).thenCall(
            (m: string, _, s: string) => {
                message = m;
                search = s;
                return Promise.resolve(search);
            }
        );
        when(mockedVSCodeNamespaces.window.showErrorMessage(anything(), anything())).thenCall(
            (m: string, s: string) => {
                message = m;
                search = s;
                return Promise.resolve(search);
            }
        );
        when(mockedVSCodeNamespaces.env.openExternal(anything())).thenCall((s: Uri) => {
            url = s.toString(true);
        });
        if (methodType === 'showNoInstallersMessage') {
            await channels.showNoInstallersMessage(activeInterpreter);
        } else {
            await channels.getInstallationChannel(Product.jupyter, info);
        }
        await verify(message, url);
    }
});
