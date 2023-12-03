// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as fs from 'fs-extra';
import nock from 'nock';
import * as path from '../../../../platform/vscode-path/path';
import { Readable } from 'stream';
import { anything, deepEqual, instance, mock, verify, when } from 'ts-mockito';
import { ConfigurationTarget, Disposable, Memento, Uri } from 'vscode';
import { JupyterSettings } from '../../../../platform/common/configSettings';
import { ConfigurationService } from '../../../../platform/common/configuration/service.node';
import { IConfigurationService, IDisposable, WidgetCDNs } from '../../../../platform/common/types';
import { noop } from '../../../../platform/common/utils/misc';
import { EXTENSION_ROOT_DIR } from '../../../../platform/constants.node';
import {
    CDNWidgetScriptSourceProvider,
    GlobalStateKeyToNeverWarnAboutNoNetworkAccess,
    GlobalStateKeyToTrackIfUserConfiguredCDNAtLeastOnce
} from './cdnWidgetScriptSourceProvider';
import { IWidgetScriptSourceProvider } from '../types';
import { dispose } from '../../../../platform/common/utils/lifecycle';
import { Common, DataScience } from '../../../../platform/common/utils/localize';
import { computeHash } from '../../../../platform/common/crypto';
import { mockedVSCodeNamespaces, resetVSCodeMocks } from '../../../../test/vscode-mock';

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports, , @typescript-eslint/no-explicit-any, , no-console */
const sanitize = require('sanitize-filename');

const unpgkUrl = 'https://unpkg.com/';
const jsdelivrUrl = 'https://cdn.jsdelivr.net/npm/';

/* eslint-disable , @typescript-eslint/no-explicit-any */
suite('ipywidget - CDN', () => {
    let scriptSourceProvider: IWidgetScriptSourceProvider;
    let configService: IConfigurationService;
    let settings: JupyterSettings;
    let memento: Memento;
    let disposables: IDisposable[] = [];
    setup(() => {
        resetVSCodeMocks();
        disposables.push(new Disposable(() => resetVSCodeMocks()));

        configService = mock(ConfigurationService);
        settings = { widgetScriptSources: [] } as any;
        when(configService.getSettings(anything())).thenReturn(settings as any);
        memento = mock<Memento>();
        scriptSourceProvider = new CDNWidgetScriptSourceProvider(instance(memento), instance(configService));
    });

    teardown(() => (disposables = dispose(disposables)));

    function createStreamFromString(str: string) {
        const readable = new Readable();
        readable._read = noop;
        readable.push(str);
        readable.push(null);
        return readable;
    }

    async function generateScriptName(moduleName: string, moduleVersion: string) {
        const hash = sanitize(await computeHash(`${moduleName}${moduleVersion}`, 'SHA-256'));
        return Uri.file(path.join(EXTENSION_ROOT_DIR, 'temp', 'scripts', hash, 'index.js')).toString();
    }
    test('Prompt to use CDN', async () => {
        when(
            mockedVSCodeNamespaces.window.showInformationMessage(
                anything(),
                anything(),
                anything(),
                anything(),
                anything()
            )
        ).thenResolve();

        await scriptSourceProvider.getWidgetScriptSource('HelloWorld', '1', true);

        verify(
            mockedVSCodeNamespaces.window.showInformationMessage(
                DataScience.useCDNForWidgetsNoInformation,
                deepEqual({ modal: true }),
                Common.ok,
                Common.doNotShowAgain,
                Common.moreInfo
            )
        ).once();
    });
    test('Warn if there is no network access and CDN is used', async () => {
        settings.widgetScriptSources = ['jsdelivr.com'];
        when(
            mockedVSCodeNamespaces.window.showWarningMessage(anything(), anything(), anything(), anything())
        ).thenResolve();
        when(memento.get(GlobalStateKeyToNeverWarnAboutNoNetworkAccess, anything())).thenReturn(false);

        await scriptSourceProvider.getWidgetScriptSource('Hello World', '1', false);

        verify(
            mockedVSCodeNamespaces.window.showWarningMessage(
                DataScience.cdnWidgetScriptNotAccessibleWarningMessage(
                    'Hello World',
                    JSON.stringify(settings.widgetScriptSources)
                ),
                Common.ok,
                Common.doNotShowAgain,
                Common.moreInfo
            )
        ).once();
    });
    test('Do not warn if there is no network access and CDN is not used', async () => {
        settings.widgetScriptSources = [];
        when(
            mockedVSCodeNamespaces.window.showWarningMessage(anything(), anything(), anything(), anything())
        ).thenResolve();
        when(memento.get(GlobalStateKeyToNeverWarnAboutNoNetworkAccess, anything())).thenReturn(false);

        await scriptSourceProvider.getWidgetScriptSource('Hello World', '1', false);

        verify(
            mockedVSCodeNamespaces.window.showWarningMessage(
                DataScience.cdnWidgetScriptNotAccessibleWarningMessage(
                    'Hello World',
                    JSON.stringify(settings.widgetScriptSources)
                ),
                Common.ok,
                Common.doNotShowAgain,
                Common.moreInfo
            )
        ).never();
    });
    test('Verify we track the fact that we should not warn again if there is no network access', async () => {
        settings.widgetScriptSources = ['jsdelivr.com'];
        when(
            mockedVSCodeNamespaces.window.showWarningMessage(anything(), anything(), anything(), anything())
        ).thenResolve(Common.doNotShowAgain as any);
        when(memento.get(GlobalStateKeyToNeverWarnAboutNoNetworkAccess, anything())).thenReturn(false);

        await scriptSourceProvider.getWidgetScriptSource('Hello World', '1', false);

        verify(
            mockedVSCodeNamespaces.window.showWarningMessage(
                DataScience.cdnWidgetScriptNotAccessibleWarningMessage(
                    'Hello World',
                    JSON.stringify(settings.widgetScriptSources)
                ),
                Common.ok,
                Common.doNotShowAgain,
                Common.moreInfo
            )
        ).once();
        verify(memento.update(GlobalStateKeyToNeverWarnAboutNoNetworkAccess, true)).once();
    });
    test('Do not prompt to use CDN if user has chosen not to use a CDN', async () => {
        when(
            mockedVSCodeNamespaces.window.showInformationMessage(
                anything(),
                anything(),
                anything(),
                anything(),
                anything()
            )
        ).thenResolve();
        when(memento.get(GlobalStateKeyToTrackIfUserConfiguredCDNAtLeastOnce, false)).thenReturn(true);

        await scriptSourceProvider.getWidgetScriptSource('HelloWorld', '1');

        verify(
            mockedVSCodeNamespaces.window.showInformationMessage(
                DataScience.useCDNForWidgetsNoInformation,
                deepEqual({ modal: true }),
                Common.ok,
                Common.doNotShowAgain,
                Common.moreInfo
            )
        ).never();
    });
    test('Return an empty item if CDN is not configured', async () => {
        settings.widgetScriptSources = [];

        const result = await scriptSourceProvider.getWidgetScriptSource('HelloWorld', '1');

        assert.deepEqual(result, { moduleName: 'HelloWorld' });
    });
    function verifyNoCDNUpdatedInSettings() {
        // Confirm message was displayed.
        verify(
            mockedVSCodeNamespaces.window.showInformationMessage(
                DataScience.useCDNForWidgetsNoInformation,
                anything(),
                Common.ok,
                Common.doNotShowAgain,
                Common.moreInfo
            )
        ).once();

        // Confirm settings were updated.
        verify(
            configService.updateSetting('widgetScriptSources', deepEqual([]), undefined, ConfigurationTarget.Global)
        ).once();
    }
    test('Do not update if prompt is dismissed', async () => {
        when(
            mockedVSCodeNamespaces.window.showInformationMessage(
                anything(),
                anything(),
                anything(),
                anything(),
                anything()
            )
        ).thenResolve();

        await scriptSourceProvider.getWidgetScriptSource('HelloWorld', '1');

        verify(configService.updateSetting(anything(), anything(), anything(), anything())).never();
        verify(memento.update(GlobalStateKeyToTrackIfUserConfiguredCDNAtLeastOnce, anything())).never();
    });
    test('Do not update settings if Cancel is clicked in prompt', async () => {
        when(
            mockedVSCodeNamespaces.window.showInformationMessage(
                anything(),
                anything(),
                anything(),
                anything(),
                anything()
            )
        ).thenResolve(Common.cancel as any);

        await scriptSourceProvider.getWidgetScriptSource('HelloWorld', '1');

        verify(configService.updateSetting(anything(), anything(), anything(), anything())).never();
        verify(memento.update(GlobalStateKeyToTrackIfUserConfiguredCDNAtLeastOnce, anything())).never();
    });
    test('Update settings to not use CDN if `Do Not Show Again` is clicked in prompt', async () => {
        when(
            mockedVSCodeNamespaces.window.showInformationMessage(
                anything(),
                anything(),
                anything(),
                anything(),
                anything()
            )
        ).thenResolve(Common.doNotShowAgain as any);

        await scriptSourceProvider.getWidgetScriptSource('HelloWorld', '1');

        verifyNoCDNUpdatedInSettings();
        verify(memento.update(GlobalStateKeyToTrackIfUserConfiguredCDNAtLeastOnce, true)).once();
    });
    test('Update settings to use CDN based on prompt', async () => {
        when(
            mockedVSCodeNamespaces.window.showInformationMessage(
                anything(),
                anything(),
                anything(),
                anything(),
                anything()
            )
        ).thenResolve(Common.ok as any);

        await scriptSourceProvider.getWidgetScriptSource('HelloWorld', '1');

        // Confirm message was displayed.
        verify(
            mockedVSCodeNamespaces.window.showInformationMessage(
                DataScience.useCDNForWidgetsNoInformation,
                anything(),
                Common.ok,
                Common.doNotShowAgain,
                Common.moreInfo
            )
        ).once();
        // Confirm settings were updated.
        verify(memento.update(GlobalStateKeyToTrackIfUserConfiguredCDNAtLeastOnce, true)).once();
        verify(
            configService.updateSetting(
                'widgetScriptSources',
                deepEqual(['jsdelivr.com', 'unpkg.com']),
                undefined,
                ConfigurationTarget.Global
            )
        ).once();
    });
    test('When CDN is turned on and widget script is not found, then display a warning about script not found on CDN', async () => {
        settings.widgetScriptSources = ['jsdelivr.com', 'unpkg.com'];

        let values = await scriptSourceProvider.getWidgetScriptSource('module1', '1');

        assert.deepEqual(values, { moduleName: 'module1' });
        const expectedMessage = DataScience.widgetScriptNotFoundOnCDNWidgetMightNotWork(
            'module1',
            '1',
            JSON.stringify((<any>settings).widgetScriptSources)
        );
        verify(
            mockedVSCodeNamespaces.window.showWarningMessage(expectedMessage, anything(), anything(), anything())
        ).once();

        // Ensure message is not displayed more than once.
        values = await scriptSourceProvider.getWidgetScriptSource('module1', '1');

        assert.deepEqual(values, { moduleName: 'module1' });
        verify(
            mockedVSCodeNamespaces.window.showWarningMessage(expectedMessage, anything(), anything(), anything())
        ).once();
    });

    [true, false].forEach((localLaunch) => {
        suite(localLaunch ? 'Local Jupyter Server' : 'Remote Jupyter Server', () => {
            test('Script source will be empty if CDN is not a configured source of widget scripts in settings', async () => {
                const value = await scriptSourceProvider.getWidgetScriptSource('HelloWorld', '1');

                assert.deepEqual(value, { moduleName: 'HelloWorld' });
                // Should not make any http calls.
                // verify(httpClient.exists(anything())).never();
            });
            function updateCDNSettings(...values: WidgetCDNs[]) {
                settings.widgetScriptSources = values;
            }
            (['unpkg.com', 'jsdelivr.com'] as WidgetCDNs[]).forEach((cdn) => {
                // Nock seems to fail randomly on CI builds. See bug
                // https://github.com/microsoft/vscode-python/issues/11442
                // eslint-disable-next-line no-invalid-this
                suite.skip(cdn, () => {
                    const moduleName = 'HelloWorld';
                    const moduleVersion = '1';
                    let baseUrl = '';
                    let scriptUri = '';
                    setup(async () => {
                        baseUrl = cdn === 'unpkg.com' ? unpgkUrl : jsdelivrUrl;
                        scriptUri = await generateScriptName(moduleName, moduleVersion);
                    });
                    teardown(() => {
                        scriptSourceProvider.dispose();
                        nock.cleanAll();
                    });
                    test('Ensure widget script is downloaded once and cached', async () => {
                        updateCDNSettings(cdn);
                        let downloadCount = 0;
                        nock(baseUrl)
                            .get(/.*/)
                            .reply(200, () => {
                                downloadCount += 1;
                                return createStreamFromString('foo');
                            });

                        const value = await scriptSourceProvider.getWidgetScriptSource(moduleName, moduleVersion);

                        assert.deepEqual(value, {
                            moduleName: 'HelloWorld',
                            scriptUri,
                            source: 'cdn'
                        });

                        const value2 = await scriptSourceProvider.getWidgetScriptSource(moduleName, moduleVersion);

                        assert.deepEqual(value2, {
                            moduleName: 'HelloWorld',
                            scriptUri,
                            source: 'cdn'
                        });

                        assert.equal(downloadCount, 1, 'Downloaded more than once');
                    });
                    test('No script source if package does not exist on CDN', async () => {
                        updateCDNSettings(cdn);
                        nock(baseUrl).get(/.*/).replyWithError('404');

                        const value = await scriptSourceProvider.getWidgetScriptSource(moduleName, moduleVersion);

                        assert.deepEqual(value, {
                            moduleName: 'HelloWorld'
                        });
                    });
                    test('Script source if package does not exist on both CDNs', async () => {
                        // Add the other cdn (the opposite of the working one)
                        const cdns =
                            cdn === 'unpkg.com'
                                ? ([cdn, 'jsdelivr.com'] as WidgetCDNs[])
                                : ([cdn, 'unpkg.com'] as WidgetCDNs[]);
                        updateCDNSettings(cdns[0], cdns[1]);
                        // Make only one cdn available
                        // when(httpClient.exists(anything())).thenCall((a) => {
                        //     if (a.includes(cdn[0])) {
                        //         return true;
                        //     }
                        //     return false;
                        // });
                        nock(baseUrl)
                            .get(/.*/)
                            .reply(200, () => {
                                return createStreamFromString('foo');
                            });
                        const value = await scriptSourceProvider.getWidgetScriptSource(moduleName, moduleVersion);

                        assert.deepEqual(value, {
                            moduleName: 'HelloWorld',
                            scriptUri,
                            source: 'cdn'
                        });
                    });

                    test('Retry if busy', async () => {
                        let retryCount = 0;
                        updateCDNSettings(cdn);
                        // when(httpClient.exists(anything())).thenResolve(true);
                        nock(baseUrl).get(/.*/).twice().replyWithError('Not found');
                        nock(baseUrl)
                            .get(/.*/)
                            .thrice()
                            .reply(200, () => {
                                retryCount = 3;
                                return createStreamFromString('foo');
                            });

                        // Then see if we can get it still.
                        const value = await scriptSourceProvider.getWidgetScriptSource(moduleName, moduleVersion);

                        assert.deepEqual(value, {
                            moduleName: 'HelloWorld',
                            scriptUri,
                            source: 'cdn'
                        });
                        assert.equal(retryCount, 3, 'Did not actually retry');
                    });
                    test('Script source already on disk', async () => {
                        updateCDNSettings(cdn);
                        // Make nobody available
                        // when(httpClient.exists(anything())).thenResolve(true);

                        // Write to where the file should eventually end up
                        const filePath = Uri.parse(scriptUri).fsPath;
                        await fs.createFile(filePath);
                        await fs.writeFile(filePath, 'foo');

                        // Then see if we can get it still.
                        const value = await scriptSourceProvider.getWidgetScriptSource(moduleName, moduleVersion);

                        assert.deepEqual(value, {
                            moduleName: 'HelloWorld',
                            scriptUri,
                            source: 'cdn'
                        });
                    });
                });
            });
        });
    });
});
