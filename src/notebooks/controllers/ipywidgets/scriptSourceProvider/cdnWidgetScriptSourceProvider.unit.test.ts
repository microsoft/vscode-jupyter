// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sinon from 'sinon';
import { assert } from 'chai';
import { anything, deepEqual, instance, mock, verify, when } from 'ts-mockito';
import { ConfigurationTarget, Disposable, Memento, type WorkspaceConfiguration } from 'vscode';
import { JupyterSettings } from '../../../../platform/common/configSettings';
import { ConfigurationService } from '../../../../platform/common/configuration/service.node';
import { IConfigurationService, IDisposable, WidgetCDNs } from '../../../../platform/common/types';
import {
    CDNWidgetScriptSourceProvider,
    GlobalStateKeyToNeverWarnAboutNoNetworkAccess,
    GlobalStateKeyToTrackIfUserConfiguredCDNAtLeastOnce,
    moduleNameToCDNUrl
} from './cdnWidgetScriptSourceProvider';
import { IWidgetScriptSourceProvider } from '../types';
import { dispose } from '../../../../platform/common/utils/lifecycle';
import { Common, DataScience } from '../../../../platform/common/utils/localize';
import { mockedVSCodeNamespaces, resetVSCodeMocks } from '../../../../test/vscode-mock';
import { HttpClient } from '../../../../platform/common/net/httpClient';

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
                suite(cdn, () => {
                    const moduleName = 'HelloWorld';
                    const moduleVersion = '1';
                    let scriptUri = '';
                    const disposables: IDisposable[] = [];
                    setup(async () => {
                        const baseUrl = cdn === 'unpkg.com' ? unpgkUrl : jsdelivrUrl;
                        scriptUri = moduleNameToCDNUrl(baseUrl, moduleName, moduleVersion);
                        const workspaceConfig = mock<WorkspaceConfiguration>();
                        when(workspaceConfig.get('proxy', anything())).thenReturn('');
                        when(mockedVSCodeNamespaces.workspace.getConfiguration('http')).thenReturn(
                            instance(workspaceConfig)
                        );
                    });
                    teardown(() => {
                        sinon.restore();
                        resetVSCodeMocks();
                        scriptSourceProvider.dispose();
                        dispose(disposables);
                        disposables.length = 0;
                    });
                    test('Verify script source', async () => {
                        updateCDNSettings(cdn);
                        sinon.stub(HttpClient.prototype, 'exists').resolves(true);

                        const value = await scriptSourceProvider.getWidgetScriptSource(moduleName, moduleVersion);

                        assert.deepEqual(value, {
                            moduleName: 'HelloWorld',
                            scriptUri,
                            source: 'cdn'
                        });
                    });
                    test('No script source if package does not exist on CDN', async () => {
                        updateCDNSettings(cdn);
                        sinon.stub(HttpClient.prototype, 'exists').resolves(false);

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
                        sinon.stub(HttpClient.prototype, 'exists').resolves(true);
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
