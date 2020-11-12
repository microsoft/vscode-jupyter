// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

// tslint:disable:no-require-imports no-var-requires
import { assert } from 'chai';
import { IDisposable } from 'monaco-editor';
import * as sinon from 'sinon';
import { Uri } from 'vscode';
import { Common, DataScience } from '../../../client/common/utils/localize';
import { IJupyterServerConnectionService } from '../../../client/remote/ui/types';
import { createEventHandler, IExtensionTestApi } from '../../common';
import { initialize } from '../../initialize';
import { JupyterServer } from '../jupyterServer';
import { canRunNotebookTests, disposeAllDisposables, hijackPrompt } from '../notebook/helper';
import { allowInSecureJupyterServerConnections, removeAllJupyterServerConnections } from './helpers';

// tslint:disable: no-any no-invalid-this
suite('Jupyter Server - (remote)', () => {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let jupyterUri: Uri;
    let jupyterServerConnectionService: IJupyterServerConnectionService;
    const insecureMessage = DataScience.insecureSessionMessage();
    suiteSetup(async function () {
        this.timeout(120_000);
        api = await initialize();
        if (!(await canRunNotebookTests())) {
            return this.skip();
        }
        jupyterUri = await JupyterServer.instance.startJupyterWithToken();
        sinon.restore();
        jupyterServerConnectionService = api.serviceContainer.get<IJupyterServerConnectionService>(
            IJupyterServerConnectionService
        );
    });
    setup(async () => {
        await removeAllJupyterServerConnections();
        await allowInSecureJupyterServerConnections(true);
    });
    teardown(async () => {
        await removeAllJupyterServerConnections();
        disposeAllDisposables(disposables);
    });
    test('There are no connections', async () => {
        const connections = await jupyterServerConnectionService.getConnections();
        assert.equal(connections.length, 0);
    });
    test('Adding/Removing connection to Jupyter without auth will trigger events & will be listed in connections', async () => {
        const addedEvent = createEventHandler(jupyterServerConnectionService, 'onDidAddServer', disposables);
        await jupyterServerConnectionService.addServer(jupyterUri);
        await addedEvent.assertFired(1_000);
        let connections = await jupyterServerConnectionService.getConnections();
        assert.equal(connections.length, 1);

        // Now remove & check events.
        const removedEvent = createEventHandler(jupyterServerConnectionService, 'onDidRemoveServer', disposables);
        jupyterServerConnectionService.disconnect(connections[0].id);
        await removedEvent.assertFired(1_000);
        connections = await jupyterServerConnectionService.getConnections();
        assert.equal(connections.length, 0);
    });
    test('Prompt to connect to non secure server is not displayed', async () => {
        await allowInSecureJupyterServerConnections(true);
        const prompt = await hijackPrompt(
            'showWarningMessage',
            { exactMatch: insecureMessage },
            { clickImmediately: true, text: Common.bannerLabelYes() },
            disposables
        );

        const addedEvent = createEventHandler(jupyterServerConnectionService, 'onDidAddServer', disposables);
        await jupyterServerConnectionService.addServer(jupyterUri);
        await addedEvent.assertFired(1_000);

        assert.equal(prompt.getDisplayCount(), 0);
        const connections = await jupyterServerConnectionService.getConnections();
        assert.equal(connections.length, 1);
    });
    test('Prompt to connect to non secure server is displayed', async () => {
        await allowInSecureJupyterServerConnections(false);
        const prompt = await hijackPrompt(
            'showWarningMessage',
            { exactMatch: insecureMessage },
            { clickImmediately: true, text: Common.bannerLabelNo() },
            disposables
        );

        const addedEvent = createEventHandler(jupyterServerConnectionService, 'onDidAddServer', disposables);
        try {
            // Remote token from Url.
            await jupyterServerConnectionService.addServer(Uri.parse(jupyterUri.toString().split('?')!.shift()!));
        } catch (ex) {
            assert.include(ex.message, DataScience.insecureSessionDenied());
        }
        await assert.eventually.isTrue(prompt.displayed);
        assert.equal(addedEvent.count, 0);
    });
});
