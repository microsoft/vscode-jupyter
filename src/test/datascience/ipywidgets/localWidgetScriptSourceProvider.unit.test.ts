// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { anything, instance, mock, when } from 'ts-mockito';
import { Uri } from 'vscode';
import { IKernel } from '../../../kernels/types';
import { LocalWidgetScriptSourceProvider } from '../../../notebooks/controllers/ipywidgets/scriptSourceProvider/localWidgetScriptSourceProvider.node';
import {
    ILocalResourceUriConverter,
    IWidgetScriptSourceProvider,
    IIPyWidgetScriptManager,
    IIPyWidgetScriptManagerFactory
} from '../../../notebooks/controllers/ipywidgets/types';

/* eslint-disable , @typescript-eslint/no-explicit-any */
suite('ipywidget - Local Widget Script Source', () => {
    let scriptSourceProvider: IWidgetScriptSourceProvider;
    let resourceConverter: ILocalResourceUriConverter;
    let kernel: IKernel;
    let scriptManagerFactory: IIPyWidgetScriptManagerFactory;
    let scriptManager: IIPyWidgetScriptManager;
    function asVSCodeUri(uri: Uri) {
        return `vscodeUri://${uri.fsPath}`;
    }
    setup(() => {
        resourceConverter = mock<ILocalResourceUriConverter>();
        scriptManagerFactory = mock<IIPyWidgetScriptManagerFactory>();
        scriptManager = mock<IIPyWidgetScriptManager>();
        when(scriptManagerFactory.getOrCreate(anything())).thenReturn(instance(scriptManager));
        kernel = mock<IKernel>();
        when(resourceConverter.asWebviewUri(anything())).thenCall((uri) => Promise.resolve(asVSCodeUri(uri)));
        scriptSourceProvider = new LocalWidgetScriptSourceProvider(
            instance(kernel),
            instance(resourceConverter),
            instance(scriptManagerFactory)
        );
    });
    test('No baseurl if Script Manager does not support it', async () => {
        when(scriptManager.getBaseUrl).thenReturn();

        assert.isOk(scriptManager.getBaseUrl);
        const baseUrl = await scriptSourceProvider.getBaseUrl!();

        assert.isUndefined(baseUrl);
    });
    test('Get baseurl', async () => {
        const uri = Uri.file(__dirname);
        when(scriptManager.getBaseUrl!()).thenResolve(uri);

        assert.isOk(scriptManager.getBaseUrl);
        const baseUrl = await scriptSourceProvider.getBaseUrl!();

        assert.strictEqual(baseUrl?.toString(), asVSCodeUri(uri).toString());
    });
    test('No script source when there are no widgets', async () => {
        when(scriptManager.getWidgetModuleMappings()).thenResolve();

        const value = await scriptSourceProvider.getWidgetScriptSource('ModuleName', '1');

        assert.deepEqual(value, { moduleName: 'ModuleName' });
    });
    test('Return empty source for widgets that cannot be found', async () => {
        when(scriptManager.getWidgetModuleMappings()).thenResolve({
            widget1: Uri.file('nbextensions/widget1/inex.js'),
            widget2: Uri.file('nbextensions/widget2/inex.js')
        });

        const value = await scriptSourceProvider.getWidgetScriptSource('widgetNotFound', '1');
        assert.deepEqual(value, {
            moduleName: 'widgetNotFound'
        });
    });
    test('Finds the widget source', async () => {
        when(scriptManager.getWidgetModuleMappings()).thenResolve({
            widget1: Uri.file('nbextensions/widget1/inex.js'),
            widget2: Uri.file('nbextensions/widget2/inex.js')
        });

        const value = await scriptSourceProvider.getWidgetScriptSource('widget1', '1');
        assert.deepEqual(value, {
            moduleName: 'widget1',
            source: 'local',
            scriptUri: asVSCodeUri(Uri.file('nbextensions/widget1/inex.js'))
        });
    });
    test('Gets the widget script sources', async () => {
        when(scriptManager.getWidgetModuleMappings()).thenResolve({
            widget1: Uri.file('nbextensions/widget1/inex.js'),
            widget2: Uri.file('nbextensions/widget2/inex.js')
        });

        const values = await scriptSourceProvider.getWidgetScriptSources!();
        assert.deepEqual(values, [
            {
                moduleName: 'widget1',
                source: 'local',
                scriptUri: asVSCodeUri(Uri.file('nbextensions/widget1/inex.js'))
            },
            {
                moduleName: 'widget2',
                source: 'local',
                scriptUri: asVSCodeUri(Uri.file('nbextensions/widget2/inex.js'))
            }
        ]);
    });
});
