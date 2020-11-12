// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

// tslint:disable:no-require-imports no-var-requires
import { assert } from 'chai';
import { IDisposable } from 'monaco-editor';
import * as sinon from 'sinon';
import { Uri } from 'vscode';
import { IPersistentState, IPersistentStateFactory } from '../../../../client/common/types';
import { Common, DataScience } from '../../../../client/common/utils/localize';
import { GlobalStateUserAllowsInsecureConnections } from '../../../../client/remote/connection/remoteConnectionsService';
import { IJupyterServerConnectionService } from '../../../../client/remote/ui/types';
import { createEventHandler, IExtensionTestApi } from '../../../common';
import { initialize } from '../../../initialize';
import { JupyterServer } from '../../jupyterServer';
import { canRunNotebookTests, disposeAllDisposables, hijackPrompt } from '../../notebook/helper';

// tslint:disable: no-any no-invalid-this
suite('Jupyter Server - (remote)', () => {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let jupyterUriWithoutAuth: Uri;
    let userAllowsInsecureConnections: IPersistentState<boolean>;
    let jupyterServerConnectionService: IJupyterServerConnectionService;
    const insecureMessage = DataScience.insecureSessionMessage();
    suiteSetup(async function () {
        this.timeout(120_000);
        api = await initialize();
        if (!(await canRunNotebookTests())) {
            return this.skip();
        }
        jupyterUriWithoutAuth = await JupyterServer.instance.startJupyterWithoutAuth();
        const stateFactory = api.serviceContainer.get<IPersistentStateFactory>(IPersistentStateFactory);
        userAllowsInsecureConnections = stateFactory.createGlobalPersistentState(
            GlobalStateUserAllowsInsecureConnections
        );
        sinon.restore();
        jupyterServerConnectionService = api.serviceContainer.get<IJupyterServerConnectionService>(
            IJupyterServerConnectionService
        );
    });
    async function removeAllConnections() {
        // Ensure we're not logged into any server.
        const connections = await jupyterServerConnectionService.getConnections();
        connections.forEach((item) => jupyterServerConnectionService.logout(item.id));
        // Allow HTTP connections without prompting.
        await userAllowsInsecureConnections.updateValue(true);
    }
    setup(removeAllConnections);
    teardown(async () => {
        await removeAllConnections();
        disposeAllDisposables(disposables);
    });
    test('There are no connections', async () => {
        const connections = await jupyterServerConnectionService.getConnections();
        assert.equal(connections.length, 0);
    });
    test('Adding/Removing connection to Jupyter without auth will trigger events & will be listed in connections', async () => {
        const addedEvent = createEventHandler(jupyterServerConnectionService, 'onDidAddServer', disposables);
        await jupyterServerConnectionService.addServer(jupyterUriWithoutAuth.toString());
        await addedEvent.assertFired(1_000);
        let connections = await jupyterServerConnectionService.getConnections();
        assert.equal(connections.length, 1);

        // Now remove & check events.
        const removedEvent = createEventHandler(jupyterServerConnectionService, 'onDidRemoveServer', disposables);
        jupyterServerConnectionService.logout(connections[0].id);
        await removedEvent.assertFired(1_000);
        connections = await jupyterServerConnectionService.getConnections();
        assert.equal(connections.length, 0);
    });
    test('Prompt to connect to non secure server is not displayed', async () => {
        await userAllowsInsecureConnections.updateValue(true);
        const prompt = await hijackPrompt(
            'showWarningMessage',
            { exactMatch: insecureMessage },
            { clickImmediately: true, text: Common.bannerLabelYes() },
            disposables
        );

        const addedEvent = createEventHandler(jupyterServerConnectionService, 'onDidAddServer', disposables);
        await jupyterServerConnectionService.addServer(jupyterUriWithoutAuth.toString());
        await addedEvent.assertFired(1_000);

        assert.equal(prompt.getDisplayCount(), 0);
        const connections = await jupyterServerConnectionService.getConnections();
        assert.equal(connections.length, 1);
    });
    test('Prompt to connect to non secure server is displayed', async () => {
        await userAllowsInsecureConnections.updateValue(false);
        const prompt = await hijackPrompt(
            'showWarningMessage',
            { exactMatch: insecureMessage },
            { clickImmediately: true, text: Common.bannerLabelYes() },
            disposables
        );

        const addedEvent = createEventHandler(jupyterServerConnectionService, 'onDidAddServer', disposables);
        await jupyterServerConnectionService.addServer(jupyterUriWithoutAuth.toString());
        await addedEvent.assertFired(1_000);

        await prompt.displayed;
        const connections = await jupyterServerConnectionService.getConnections();
        assert.equal(connections.length, 1);
    });
});
