// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { anything, instance, mock, when } from 'ts-mockito';
import { Uri } from 'vscode';
import { IJupyterKernelSpec, IKernel, RemoteKernelConnectionMetadata } from '../../../kernels/types';
import { IWidgetScriptSourceProvider } from '../../../notebooks/controllers/ipywidgets/types';
import {
    IIPyWidgetScriptManager,
    IIPyWidgetScriptManagerFactory
} from '../../../notebooks/controllers/ipywidgets/types';
import { RemoteWidgetScriptSourceProvider } from '../../../notebooks/controllers/ipywidgets/scriptSourceProvider/remoteWidgetScriptSourceProvider';

/* eslint-disable , @typescript-eslint/no-explicit-any */
suite('DataScience - ipywidget - Remote Widget Script Source', () => {
    let scriptSourceProvider: IWidgetScriptSourceProvider;
    let kernel: IKernel;
    let scriptManagerFactory: IIPyWidgetScriptManagerFactory;
    let scriptManager: IIPyWidgetScriptManager;
    const baseUrl = 'http://hello.com/';
    setup(() => {
        scriptManagerFactory = mock<IIPyWidgetScriptManagerFactory>();
        scriptManager = mock<IIPyWidgetScriptManager>();
        when(scriptManagerFactory.getOrCreate(anything())).thenReturn(instance(scriptManager));
        kernel = mock<IKernel>();
        const kernelConnection: RemoteKernelConnectionMetadata = {
            baseUrl,
            id: '1',
            kernelSpec: instance(mock<IJupyterKernelSpec>()),
            kind: 'startUsingRemoteKernelSpec',
            serverId: '2'
        };
        when(kernel.kernelConnectionMetadata).thenReturn(kernelConnection);
        scriptSourceProvider = new RemoteWidgetScriptSourceProvider(instance(kernel), instance(scriptManagerFactory));
    });
    test('Get baseurl', async () => {
        const uri = await scriptSourceProvider.getBaseUrl!();

        assert.strictEqual(uri?.toString(), baseUrl.toString());
    });
    test('No script source when there are no widgets', async () => {
        when(scriptManager.getWidgetModuleMappings()).thenResolve();

        const value = await scriptSourceProvider.getWidgetScriptSource('ModuleName', '1');

        assert.deepEqual(value, { moduleName: 'ModuleName' });
    });
    test('Return empty source for widgets that cannot be found', async () => {
        when(scriptManager.getWidgetModuleMappings()).thenResolve({
            widget1: Uri.parse(baseUrl + 'nbextensions/widget1/inex.js'),
            widget2: Uri.parse(baseUrl + 'nbextensions/widget2/inex.js')
        });

        const value = await scriptSourceProvider.getWidgetScriptSource('widgetNotFound', '1');
        assert.deepEqual(value, {
            moduleName: 'widgetNotFound'
        });
    });
    test('Finds the widget source', async () => {
        when(scriptManager.getWidgetModuleMappings()).thenResolve({
            widget1: Uri.parse(baseUrl + 'nbextensions/widget1/inex.js'),
            widget2: Uri.parse(baseUrl + 'nbextensions/widget2/inex.js')
        });

        const value = await scriptSourceProvider.getWidgetScriptSource('widget1', '1');
        assert.deepEqual(value, {
            moduleName: 'widget1',
            source: 'remote',
            scriptUri: Uri.parse(baseUrl + 'nbextensions/widget1/inex.js').toString()
        });
    });
    test('Gets the widget script sources', async () => {
        when(scriptManager.getWidgetModuleMappings()).thenResolve({
            widget1: Uri.parse(baseUrl + 'nbextensions/widget1/inex.js'),
            widget2: Uri.parse(baseUrl + 'nbextensions/widget2/inex.js')
        });

        const values = await scriptSourceProvider.getWidgetScriptSources!();
        assert.deepEqual(values, [
            {
                moduleName: 'widget1',
                source: 'remote',
                scriptUri: Uri.parse(baseUrl + 'nbextensions/widget1/inex.js').toString()
            },
            {
                moduleName: 'widget2',
                source: 'remote',
                scriptUri: Uri.parse(baseUrl + 'nbextensions/widget2/inex.js').toString()
            }
        ]);
    });
});
