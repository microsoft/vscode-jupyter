// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sinon from 'sinon';
import { assert } from 'chai';
import * as nodeFetch from 'node-fetch';
import { anything, instance, mock, when } from 'ts-mockito';
import { JupyterRequestCreator } from '../../kernels/jupyter/session/jupyterRequestCreator.web';
import { IJupyterRequestCreator, IJupyterServerUriStorage } from '../../kernels/jupyter/types';
import { ApplicationShell } from '../../platform/common/application/applicationShell';
import { AsyncDisposableRegistry } from '../../platform/common/asyncDisposableRegistry';
import { ConfigurationService } from '../../platform/common/configuration/service.node';
import { IDisposableRegistry } from '../../platform/common/types';
import { MultiStepInputFactory } from '../../platform/common/utils/multiStepInput';
import { MockInputBox } from '../../test/datascience/mockInputBox';
import { MockQuickPick } from '../../test/datascience/mockQuickPick';
import { JupyterHubPasswordConnect } from './jupyterHubPasswordConnect';
import { Disposable, InputBox } from 'vscode';
import { noop } from '../../test/core';

/* eslint-disable @typescript-eslint/no-explicit-any, ,  */
suite('Jupyter Hub Password Connect', () => {
    let jupyterPasswordConnect: JupyterHubPasswordConnect;
    let appShell: ApplicationShell;
    let configService: ConfigurationService;
    let requestCreator: IJupyterRequestCreator;

    let inputBox: InputBox;
    setup(() => {
        inputBox = {
            show: noop,
            onDidAccept: noop as any,
            onDidHide: noop as any,
            hide: noop,
            dispose: noop as any,
            onDidChangeValue: noop as any,
            onDidTriggerButton: noop as any,
            valueSelection: undefined,
            totalSteps: undefined,
            validationMessage: '',
            busy: false,
            buttons: [],
            enabled: true,
            ignoreFocusOut: false,
            password: false,
            step: undefined,
            title: '',
            value: '',
            prompt: '',
            placeholder: ''
        };
        sinon.stub(inputBox, 'show').callsFake(noop);
        sinon.stub(inputBox, 'onDidHide').callsFake(() => new Disposable(noop));
        sinon.stub(inputBox, 'onDidAccept').callsFake((cb) => {
            (cb as Function)();
            return new Disposable(noop);
        });

        appShell = mock(ApplicationShell);
        when(appShell.showInputBox(anything())).thenReturn(Promise.resolve('Python'));
        when(appShell.createInputBox()).thenReturn(inputBox);
        const multiStepFactory = new MultiStepInputFactory(instance(appShell));
        const mockDisposableRegistry = mock(AsyncDisposableRegistry);
        configService = mock(ConfigurationService);
        requestCreator = mock(JupyterRequestCreator);
        const serverUriStorage = mock<IJupyterServerUriStorage>();
        const disposables = mock<IDisposableRegistry>();

        jupyterPasswordConnect = new JupyterHubPasswordConnect(
            instance(appShell),
            multiStepFactory,
            instance(mockDisposableRegistry),
            instance(configService),
            undefined,
            instance(requestCreator),
            instance(serverUriStorage),
            instance(disposables)
        );
    });

    function createJupyterHubSetup() {
        const dsSettings = {
            allowUnauthorizedRemoteConnection: false
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;
        when(configService.getSettings(anything())).thenReturn(dsSettings as any);

        const quickPick = new MockQuickPick('');
        const input = new MockInputBox('test', 2); // We want the input box to enter twice for this scenario
        when(appShell.createQuickPick()).thenReturn(quickPick!);
        when(appShell.createInputBox()).thenReturn(input);

        const hubActiveResponse = mock(nodeFetch.Response);
        when(hubActiveResponse.ok).thenReturn(true);
        when(hubActiveResponse.status).thenReturn(200);
        const invalidResponse = mock(nodeFetch.Response);
        when(invalidResponse.ok).thenReturn(false);
        when(invalidResponse.status).thenReturn(404);
        const loginResponse = mock(nodeFetch.Response);
        const loginHeaders = mock(nodeFetch.Headers);
        when(loginHeaders.raw()).thenReturn({ 'set-cookie': ['super-cookie-login=foobar'] });
        when(loginResponse.ok).thenReturn(true);
        when(loginResponse.status).thenReturn(302);
        when(loginResponse.headers).thenReturn(instance(loginHeaders));
        const tokenResponse = mock(nodeFetch.Response);
        when(tokenResponse.ok).thenReturn(true);
        when(tokenResponse.status).thenReturn(200);
        when(tokenResponse.json()).thenResolve({
            token: 'foobar',
            id: '1'
        });

        instance(hubActiveResponse as any).then = undefined;
        instance(invalidResponse as any).then = undefined;
        instance(loginResponse as any).then = undefined;
        instance(tokenResponse as any).then = undefined;

        return async (url: nodeFetch.RequestInfo, init?: nodeFetch.RequestInit) => {
            const urlString = url.toString().toLowerCase();
            if (urlString === 'http://testname:8888/hub/api') {
                return instance(hubActiveResponse);
            } else if (urlString === 'http://testname:8888/hub/login?next=') {
                return instance(loginResponse);
            } else if (
                urlString === 'http://testname:8888/hub/api/users/test/tokens' &&
                init &&
                init.method === 'POST' &&
                (init.headers as any).Referer === 'http://testname:8888/hub/login' &&
                (init.headers as any).Cookie === ';super-cookie-login=foobar'
            ) {
                return instance(tokenResponse);
            }
            return instance(invalidResponse);
        };
    }
    test('Jupyter hub', async () => {
        const fetch = createJupyterHubSetup();
        when(requestCreator.getFetchMethod()).thenReturn(fetch as any);

        const result = await jupyterPasswordConnect.getPasswordConnectionInfo({
            url: 'http://TESTNAME:8888/',
            handle: '1234'
        });
        assert.ok(result, 'No hub connection info');
        assert.equal(result?.remappedBaseUrl, 'http://testname:8888/user/test', 'Url not remapped');
        assert.equal(result?.remappedToken, 'foobar', 'Token should be returned in URL');
        assert.ok(result?.requestHeaders, 'No request headers returned for jupyter hub');
    });
});
