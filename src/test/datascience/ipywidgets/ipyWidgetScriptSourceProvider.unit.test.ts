// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as sinon from 'sinon';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { ConfigurationChangeEvent, EventEmitter, Memento } from 'vscode';
import { ApplicationShell } from '../../../platform/common/application/applicationShell';
import { IApplicationShell, IWorkspaceService } from '../../../platform/common/application/types';
import { WorkspaceService } from '../../../platform/common/application/workspace.node';
import { ConfigurationService } from '../../../platform/common/configuration/service.node';
import { HttpClient } from '../../../platform/common/net/httpClient';
import { PersistentState, PersistentStateFactory } from '../../../platform/common/persistentState';
import { FileSystem } from '../../../platform/common/platform/fileSystem.node';
import { IConfigurationService, IExtensionContext, IJupyterSettings, ReadWrite } from '../../../platform/common/types';
import { IKernel, LocalKernelSpecConnectionMetadata, RemoteKernelSpecConnectionMetadata } from '../../../kernels/types';
import { IPyWidgetScriptSourceProvider } from '../../../notebooks/controllers/ipywidgets/scriptSourceProvider/ipyWidgetScriptSourceProvider';
import { LocalWidgetScriptSourceProvider } from '../../../notebooks/controllers/ipywidgets/scriptSourceProvider/localWidgetScriptSourceProvider.node';
import { RemoteWidgetScriptSourceProvider } from '../../../notebooks/controllers/ipywidgets/scriptSourceProvider/remoteWidgetScriptSourceProvider';
import {
    ILocalResourceUriConverter,
    IWidgetScriptSourceProviderFactory
} from '../../../notebooks/controllers/ipywidgets/types';
import { ScriptSourceProviderFactory } from '../../../notebooks/controllers/ipywidgets/scriptSourceProvider/scriptSourceProviderFactory.node';
import { CDNWidgetScriptSourceProvider } from '../../../notebooks/controllers/ipywidgets/scriptSourceProvider/cdnWidgetScriptSourceProvider';
import { IPyWidgetScriptManagerFactory } from '../../../notebooks/controllers/ipywidgets/scriptSourceProvider/ipyWidgetScriptManagerFactory.node';
import { NbExtensionsPathProvider } from '../../../notebooks/controllers/ipywidgets/scriptSourceProvider/nbExtensionsPathProvider.node';
import { JupyterPaths } from '../../../kernels/raw/finder/jupyterPaths.node';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */

suite('DataScience - ipywidget - Widget Script Source Provider', () => {
    let scriptSourceProvider: IPyWidgetScriptSourceProvider;
    let kernel: IKernel;
    let configService: IConfigurationService;
    let settings: ReadWrite<IJupyterSettings>;
    let appShell: IApplicationShell;
    let workspaceService: IWorkspaceService;
    let scriptSourceFactory: IWidgetScriptSourceProviderFactory;
    let onDidChangeWorkspaceSettings: EventEmitter<ConfigurationChangeEvent>;
    let userSelectedOkOrDoNotShowAgainInPrompt: PersistentState<boolean>;
    let context: IExtensionContext;
    let memento: Memento;
    let jupyterPaths: JupyterPaths;
    setup(() => {
        configService = mock(ConfigurationService);
        appShell = mock(ApplicationShell);
        workspaceService = mock(WorkspaceService);
        context = mock<IExtensionContext>();
        memento = mock<Memento>();
        onDidChangeWorkspaceSettings = new EventEmitter<ConfigurationChangeEvent>();
        when(workspaceService.onDidChangeConfiguration).thenReturn(onDidChangeWorkspaceSettings.event);
        const stateFactory = mock(PersistentStateFactory);
        userSelectedOkOrDoNotShowAgainInPrompt = mock<PersistentState<boolean>>();
        kernel = mock<IKernel>();
        when(stateFactory.createGlobalPersistentState(anything(), anything())).thenReturn(
            instance(userSelectedOkOrDoNotShowAgainInPrompt)
        );
        settings = { widgetScriptSources: [] } as any;
        when(configService.getSettings(anything())).thenReturn(settings as any);
        when(userSelectedOkOrDoNotShowAgainInPrompt.value).thenReturn(false);
        when(userSelectedOkOrDoNotShowAgainInPrompt.updateValue(anything())).thenResolve();
    });
    teardown(() => sinon.restore());
    function createScritpSourceProvider() {
        const httpClient = mock(HttpClient);
        const resourceConverter = mock<ILocalResourceUriConverter>();
        const fs = mock(FileSystem);
        jupyterPaths = mock<JupyterPaths>();
        const scriptManagerFactory = new IPyWidgetScriptManagerFactory(
            new NbExtensionsPathProvider(),
            instance(fs),
            instance(context),
            instance(httpClient),
            instance(jupyterPaths)
        );
        scriptSourceFactory = new ScriptSourceProviderFactory(
            instance(configService),
            scriptManagerFactory,
            instance(appShell),
            instance(memento)
        );

        scriptSourceProvider = new IPyWidgetScriptSourceProvider(
            instance(kernel),
            instance(resourceConverter),
            instance(configService),
            instance(httpClient),
            scriptSourceFactory,
            Promise.resolve(true)
        );
    }
    [true, false].forEach((localLaunch) => {
        suite(localLaunch ? 'Local Jupyter Server' : 'Remote Jupyter Server', () => {
            setup(() => {
                if (localLaunch) {
                    when(kernel.kernelConnectionMetadata).thenReturn(<LocalKernelSpecConnectionMetadata>{
                        id: '',
                        kernelSpec: {},
                        kind: 'startUsingLocalKernelSpec'
                    });
                } else {
                    when(kernel.kernelConnectionMetadata).thenReturn(<RemoteKernelSpecConnectionMetadata>{
                        baseUrl: '',
                        id: '',
                        kernelSpec: {},
                        kind: 'startUsingRemoteKernelSpec'
                    });
                }
                createScritpSourceProvider();
            });
            test('Attempt to get widget source from CDN', async () => {
                settings.widgetScriptSources = ['jsdelivr.com', 'unpkg.com'];
                const localOrRemoteSource = localLaunch
                    ? sinon.stub(LocalWidgetScriptSourceProvider.prototype, 'getWidgetScriptSource')
                    : sinon.stub(RemoteWidgetScriptSourceProvider.prototype, 'getWidgetScriptSource');
                const cdnSource = sinon.stub(CDNWidgetScriptSourceProvider.prototype, 'getWidgetScriptSource');

                localOrRemoteSource.resolves({ moduleName: 'HelloWorld' });
                cdnSource.resolves({ moduleName: 'HelloWorld' });

                const value = await scriptSourceProvider.getWidgetScriptSource('HelloWorld', '1');

                assert.deepEqual(value, { moduleName: 'HelloWorld' });
                assert.isTrue(cdnSource.calledOnce);
                assert.isTrue(localOrRemoteSource.calledOnce);
                // Give preference to CDN.
                assert.isTrue(cdnSource.calledBefore(localOrRemoteSource));
            });
            test('Widget sources should respect changes to configuration settings', async () => {
                // 1. Search CDN then local/remote juptyer.
                settings.widgetScriptSources = ['jsdelivr.com', 'unpkg.com'];
                const localOrRemoteSource = localLaunch
                    ? sinon.stub(LocalWidgetScriptSourceProvider.prototype, 'getWidgetScriptSource')
                    : sinon.stub(RemoteWidgetScriptSourceProvider.prototype, 'getWidgetScriptSource');
                const cdnSource = sinon.stub(CDNWidgetScriptSourceProvider.prototype, 'getWidgetScriptSource');
                cdnSource.resolves({ moduleName: 'moduleCDN', scriptUri: '1', source: 'cdn' });

                let values = await scriptSourceProvider.getWidgetScriptSource('ModuleName', '`');

                assert.deepEqual(values, { moduleName: 'moduleCDN', scriptUri: '1', source: 'cdn' });
                assert.isFalse(localOrRemoteSource.calledOnce);
                assert.isTrue(cdnSource.calledOnce);

                // 2. Update settings to remove the use of CDNs
                localOrRemoteSource.reset();
                cdnSource.reset();
                cdnSource.resolves({ moduleName: 'moduleCDN' });
                localOrRemoteSource.resolves({ moduleName: 'moduleLocal', scriptUri: '1', source: 'local' });
                settings.widgetScriptSources = [];

                values = await scriptSourceProvider.getWidgetScriptSource('ModuleName', '`');
                assert.deepEqual(values, { moduleName: 'moduleLocal', scriptUri: '1', source: 'local' });
                assert.isTrue(localOrRemoteSource.calledOnce);
                assert.isTrue(cdnSource.calledOnce);
            });
            test('Widget source should support fall back search', async () => {
                // 1. Search CDN and if that fails then get from local/remote.
                settings.widgetScriptSources = ['jsdelivr.com', 'unpkg.com'];
                const localOrRemoteSource = localLaunch
                    ? sinon.stub(LocalWidgetScriptSourceProvider.prototype, 'getWidgetScriptSource')
                    : sinon.stub(RemoteWidgetScriptSourceProvider.prototype, 'getWidgetScriptSource');
                const cdnSource = sinon.stub(CDNWidgetScriptSourceProvider.prototype, 'getWidgetScriptSource');
                localOrRemoteSource.resolves({ moduleName: 'moduleLocal', scriptUri: '1', source: 'local' });
                cdnSource.resolves({ moduleName: 'moduleCDN' });

                const value = await scriptSourceProvider.getWidgetScriptSource('', '');

                // 1. Confirm CDN was first searched, then local/remote
                assert.deepEqual(value, { moduleName: 'moduleLocal', scriptUri: '1', source: 'local' });
                assert.isTrue(localOrRemoteSource.calledOnce);
                assert.isTrue(cdnSource.calledOnce);
                // Confirm we first searched CDN before going to local/remote.
                cdnSource.calledBefore(localOrRemoteSource);
            });
            test('Widget sources from CDN should be given preference', async () => {
                settings.widgetScriptSources = ['jsdelivr.com', 'unpkg.com'];
                const localOrRemoteSource = localLaunch
                    ? sinon.stub(LocalWidgetScriptSourceProvider.prototype, 'getWidgetScriptSource')
                    : sinon.stub(RemoteWidgetScriptSourceProvider.prototype, 'getWidgetScriptSource');
                const cdnSource = sinon.stub(CDNWidgetScriptSourceProvider.prototype, 'getWidgetScriptSource');

                localOrRemoteSource.resolves({ moduleName: 'module1' });
                cdnSource.resolves({ moduleName: 'module1', scriptUri: '1', source: 'cdn' });

                const values = await scriptSourceProvider.getWidgetScriptSource('ModuleName', '1');

                assert.deepEqual(values, { moduleName: 'module1', scriptUri: '1', source: 'cdn' });
                assert.isFalse(localOrRemoteSource.calledOnce);
                assert.isTrue(cdnSource.calledOnce);
                verify(appShell.showWarningMessage(anything(), anything(), anything(), anything())).never();
            });
        });
    });
});
