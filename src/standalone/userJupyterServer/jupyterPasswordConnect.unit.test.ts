// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sinon from 'sinon';
import { assert } from 'chai';
import * as nodeFetch from 'node-fetch';
import * as typemoq from 'typemoq';
import { anything, instance, mock, when } from 'ts-mockito';
import { JupyterRequestCreator } from '../../kernels/jupyter/session/jupyterRequestCreator.web';
import { IJupyterRequestCreator, IJupyterServerUriStorage } from '../../kernels/jupyter/types';
import { ApplicationShell } from '../../platform/common/application/applicationShell';
import { ConfigurationService } from '../../platform/common/configuration/service.node';
import { IDisposableRegistry } from '../../platform/common/types';
import { JupyterPasswordConnect } from './jupyterPasswordConnect';
import { Disposable, InputBox } from 'vscode';
import { noop } from '../../test/core';

/* eslint-disable @typescript-eslint/no-explicit-any, ,  */
suite('JupyterServer Password Connect', () => {
    let jupyterPasswordConnect: JupyterPasswordConnect;
    let appShell: ApplicationShell;
    let configService: ConfigurationService;
    let requestCreator: IJupyterRequestCreator;

    const xsrfValue: string = '12341234';
    const sessionName: string = 'sessionName';
    const sessionValue: string = 'sessionValue';
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
        configService = mock(ConfigurationService);
        requestCreator = mock(JupyterRequestCreator);
        const serverUriStorage = mock<IJupyterServerUriStorage>();
        const disposables = mock<IDisposableRegistry>();

        jupyterPasswordConnect = new JupyterPasswordConnect(
            instance(appShell),
            instance(configService),
            undefined,
            instance(requestCreator),
            instance(serverUriStorage),
            instance(disposables)
        );
    });

    function createMockSetup(secure: boolean, ok: boolean, xsrfReponseStatusCode: 200 | 302 | 401 = 302) {
        const dsSettings = {
            allowUnauthorizedRemoteConnection: secure
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;
        when(configService.getSettings(anything())).thenReturn(dsSettings as any);

        // Set up our fake node fetch
        const fetchMock: typemoq.IMock<typeof nodeFetch.default> = typemoq.Mock.ofInstance(nodeFetch.default);
        const rootUrl = secure ? 'https://TESTNAME:8888/' : 'http://TESTNAME:8888/';

        // Mock our first call to get xsrf cookie
        const mockXsrfResponse = typemoq.Mock.ofType(nodeFetch.Response);
        const mockXsrfHeaders = typemoq.Mock.ofType(nodeFetch.Headers);
        mockXsrfHeaders
            .setup((mh) => mh.raw())
            .returns(() => {
                return { 'set-cookie': [`_xsrf=${xsrfValue}`] };
            });
        mockXsrfResponse.setup((mr) => mr.ok).returns(() => ok);
        mockXsrfResponse.setup((mr) => mr.status).returns(() => xsrfReponseStatusCode);
        mockXsrfResponse.setup((mr) => mr.headers).returns(() => mockXsrfHeaders.object);

        const mockHubResponse = typemoq.Mock.ofType(nodeFetch.Response);
        mockHubResponse.setup((mr) => mr.ok).returns(() => false);
        mockHubResponse.setup((mr) => mr.status).returns(() => 404);

        fetchMock
            .setup((fm) =>
                fm(
                    `${rootUrl}login?`,
                    typemoq.It.isObjectWith({
                        method: 'get',
                        headers: { Connection: 'keep-alive' }
                    })
                )
            )
            .returns(() => Promise.resolve(mockXsrfResponse.object));
        fetchMock
            .setup((fm) =>
                fm(
                    `${rootUrl}tree?`,
                    typemoq.It.isObjectWith({
                        method: 'get',
                        headers: { Connection: 'keep-alive' }
                    })
                )
            )
            .returns(() => Promise.resolve(mockXsrfResponse.object));
        fetchMock
            .setup((fm) =>
                fm(
                    `${rootUrl}hub/api`,
                    typemoq.It.isObjectWith({
                        method: 'get',
                        headers: { Connection: 'keep-alive' }
                    })
                )
            )
            .returns(() => Promise.resolve(mockHubResponse.object));

        return { fetchMock, mockXsrfHeaders, mockXsrfResponse };
    }

    test('With Password', async () => {
        inputBox.value = 'Python';
        when(appShell.showInputBox(anything())).thenReturn(Promise.resolve('Python'));
        const { fetchMock, mockXsrfHeaders, mockXsrfResponse } = createMockSetup(false, true);

        // Mock our second call to get session cookie
        const mockSessionResponse = typemoq.Mock.ofType(nodeFetch.Response);
        const mockSessionHeaders = typemoq.Mock.ofType(nodeFetch.Headers);
        mockSessionHeaders
            .setup((mh) => mh.raw())
            .returns(() => {
                return {
                    'set-cookie': [`${sessionName}=${sessionValue}`]
                };
            });
        mockSessionResponse.setup((mr) => mr.status).returns(() => 302);
        mockSessionResponse.setup((mr) => mr.headers).returns(() => mockSessionHeaders.object);

        const postParams = new URLSearchParams();
        postParams.append('_xsrf', '12341234');
        postParams.append('password', 'Python');

        // typemoq doesn't love this comparison, so generalize it a bit
        fetchMock
            .setup((fm) =>
                fm(
                    'http://TESTNAME:8888/login?',
                    typemoq.It.isObjectWith({
                        method: 'post',
                        headers: {
                            Cookie: `_xsrf=${xsrfValue}`,
                            Connection: 'keep-alive',
                            'content-type': 'application/x-www-form-urlencoded;charset=UTF-8'
                        },
                        body: postParams.toString()
                    })
                )
            )
            .returns(() => Promise.resolve(mockSessionResponse.object));
        when(requestCreator.getFetchMethod()).thenReturn(fetchMock.object as any);

        const result = await jupyterPasswordConnect.getPasswordConnectionInfo({
            url: 'http://TESTNAME:8888/',
            isTokenEmpty: true,
            handle: '1234'
        });
        assert(result, 'Failed to get password');
        if (result) {
            // eslint-disable-next-line
            assert.ok((result.requestHeaders as any).Cookie, 'No cookie');
        }

        // Verfiy calls
        mockXsrfHeaders.verifyAll();
        mockSessionHeaders.verifyAll();
        mockXsrfResponse.verifyAll();
        mockSessionResponse.verifyAll();
        fetchMock.verifyAll();
    });
    test('Empty Password and empty token', async () => {
        when(appShell.showInputBox(anything())).thenReject(new Error('Should not be called'));
        const { fetchMock, mockXsrfHeaders, mockXsrfResponse } = createMockSetup(false, true, 200);

        // Mock our second call to get session cookie
        const mockSessionResponse = typemoq.Mock.ofType(nodeFetch.Response);
        const mockSessionHeaders = typemoq.Mock.ofType(nodeFetch.Headers);
        mockSessionHeaders
            .setup((mh) => mh.raw())
            .returns(() => {
                return {
                    'set-cookie': [`${sessionName}=${sessionValue}`]
                };
            });
        mockSessionResponse.setup((mr) => mr.status).returns(() => 302);
        mockSessionResponse.setup((mr) => mr.headers).returns(() => mockSessionHeaders.object);

        const postParams = new URLSearchParams();
        postParams.append('_xsrf', '12341234');
        postParams.append('password', '');

        // typemoq doesn't love this comparison, so generalize it a bit
        fetchMock
            .setup((fm) =>
                fm(
                    'http://TESTNAME:8888/login?',
                    typemoq.It.isObjectWith({
                        method: 'post',
                        headers: {
                            Cookie: `_xsrf=${xsrfValue}`,
                            Connection: 'keep-alive',
                            'content-type': 'application/x-www-form-urlencoded;charset=UTF-8'
                        },
                        body: postParams.toString()
                    })
                )
            )
            .returns(() => Promise.resolve(mockSessionResponse.object));
        when(requestCreator.getFetchMethod()).thenReturn(fetchMock.object as any);

        const result = await jupyterPasswordConnect.getPasswordConnectionInfo({
            url: 'http://TESTNAME:8888/',
            isTokenEmpty: true,
            handle: '1234'
        });
        assert(result, 'Failed to get password');
        if (result) {
            // eslint-disable-next-line
            assert.ok((result.requestHeaders as any).Cookie, 'No cookie');
        }

        // Verfiy calls
        mockXsrfHeaders.verifyAll();
        mockSessionHeaders.verifyAll();
        mockXsrfResponse.verifyAll();
        mockSessionResponse.verifyAll();
        fetchMock.verifyAll();
    });
    test('Password required and non-empty token', async () => {
        when(appShell.showInputBox(anything())).thenReject(new Error('Should not be called'));
        const { fetchMock, mockXsrfHeaders, mockXsrfResponse } = createMockSetup(false, true, 401);

        // Mock our second call to get session cookie
        const mockSessionResponse = typemoq.Mock.ofType(nodeFetch.Response);
        const mockSessionHeaders = typemoq.Mock.ofType(nodeFetch.Headers);
        mockSessionHeaders
            .setup((mh) => mh.raw())
            .returns(() => {
                return {
                    'set-cookie': [`${sessionName}=${sessionValue}`]
                };
            });
        mockSessionResponse.setup((mr) => mr.status).returns(() => 302);
        mockSessionResponse.setup((mr) => mr.headers).returns(() => mockSessionHeaders.object);

        const postParams = new URLSearchParams();
        postParams.append('_xsrf', '12341234');
        postParams.append('password', '');

        // typemoq doesn't love this comparison, so generalize it a bit
        fetchMock
            .setup((fm) =>
                fm(
                    'http://TESTNAME:8888/login?',
                    typemoq.It.isObjectWith({
                        method: 'post',
                        headers: {
                            Cookie: `_xsrf=${xsrfValue}`,
                            Connection: 'keep-alive',
                            'content-type': 'application/x-www-form-urlencoded;charset=UTF-8'
                        },
                        body: postParams.toString()
                    })
                )
            )
            .returns(() => Promise.resolve(mockSessionResponse.object));
        when(requestCreator.getFetchMethod()).thenReturn(fetchMock.object as any);

        const result = await jupyterPasswordConnect.getPasswordConnectionInfo({
            url: 'http://TESTNAME:8888/',
            isTokenEmpty: false,
            handle: '1234'
        });
        assert(result, 'Failed to get password');
        if (result) {
            // eslint-disable-next-line
            assert.isUndefined(result.requestHeaders);
            assert.isUndefined(result.remappedToken);
            assert.isUndefined(result.requestHeaders);
            assert.isTrue(result.requiresPassword);
        }

        // Verfiy calls
        mockXsrfHeaders.verifyAll();
        mockSessionHeaders.verifyAll();
        mockXsrfResponse.verifyAll();
        mockSessionResponse.verifyAll();
        fetchMock.verifyAll();
    });

    test('Without a Password and allowUnauthorized', async () => {
        const { fetchMock, mockXsrfHeaders, mockXsrfResponse } = createMockSetup(true, true);

        // Mock our second call to get session cookie
        const mockSessionResponse = typemoq.Mock.ofType(nodeFetch.Response);
        const mockSessionHeaders = typemoq.Mock.ofType(nodeFetch.Headers);
        mockSessionHeaders
            .setup((mh) => mh.raw())
            .returns(() => {
                return {
                    'set-cookie': [`${sessionName}=${sessionValue}`]
                };
            });
        mockSessionResponse.setup((mr) => mr.status).returns(() => 302);
        mockSessionResponse.setup((mr) => mr.headers).returns(() => mockSessionHeaders.object);

        // typemoq doesn't love this comparison, so generalize it a bit
        fetchMock
            .setup((fm) =>
                fm(
                    'https://TESTNAME:8888/login?',
                    typemoq.It.isObjectWith({
                        method: 'post',
                        headers: {
                            Cookie: `_xsrf=${xsrfValue}`,
                            Connection: 'keep-alive',
                            'content-type': 'application/x-www-form-urlencoded;charset=UTF-8'
                        }
                    })
                )
            )
            .returns(() => Promise.resolve(mockSessionResponse.object));
        when(requestCreator.getFetchMethod()).thenReturn(fetchMock.object as any);

        const result = await jupyterPasswordConnect.getPasswordConnectionInfo({
            url: 'https://TESTNAME:8888/',
            isTokenEmpty: true,
            handle: '1234'
        });
        assert(result, 'Failed to get password');
        if (result) {
            // eslint-disable-next-line
            assert.ok((result.requestHeaders as any).Cookie, 'No cookie');
        }

        // Verfiy calls
        mockXsrfHeaders.verifyAll();
        mockSessionHeaders.verifyAll();
        mockXsrfResponse.verifyAll();
        mockSessionResponse.verifyAll();
        fetchMock.verifyAll();
    });

    test('Failure', async () => {
        const { fetchMock, mockXsrfHeaders, mockXsrfResponse } = createMockSetup(false, false);
        when(requestCreator.getFetchMethod()).thenReturn(fetchMock.object as any);

        const result = await jupyterPasswordConnect.getPasswordConnectionInfo({
            url: 'http://TESTNAME:8888/',
            isTokenEmpty: true,
            handle: '1234'
        });
        assert(!result.remappedBaseUrl);
        assert(!result.requestHeaders);
        assert(!result.requestHeaders);

        // Verfiy calls
        mockXsrfHeaders.verifyAll();
        mockXsrfResponse.verifyAll();
        fetchMock.verifyAll();
    });

    test('Bad password followed by good password.', async () => {
        // Reconfigure our app shell to first give a bad password
        inputBox.value = 'JUNK';
        when(appShell.showInputBox(anything())).thenReturn(Promise.resolve('JUNK'));

        const { fetchMock, mockXsrfHeaders, mockXsrfResponse } = createMockSetup(false, true);

        // Mock a bad request to the session cookie with the password JUNK
        const mockSessionResponseBad = typemoq.Mock.ofType(nodeFetch.Response);
        const mockSessionHeadersBad = typemoq.Mock.ofType(nodeFetch.Headers);
        mockSessionHeadersBad
            .setup((mh) => mh.raw())
            .returns(() => {
                return {
                    'set-cookie': [`${sessionName}=${sessionValue}`]
                };
            });
        mockSessionResponseBad.setup((mr) => mr.status).returns(() => 401);
        mockSessionResponseBad.setup((mr) => mr.headers).returns(() => mockSessionHeadersBad.object);

        let postParams = new URLSearchParams();
        postParams.append('_xsrf', '12341234');
        postParams.append('password', 'JUNK');

        fetchMock
            .setup((fm) =>
                fm(
                    'http://TESTNAME:8888/login?',
                    typemoq.It.isObjectWith({
                        method: 'post',
                        headers: {
                            Cookie: `_xsrf=${xsrfValue}`,
                            Connection: 'keep-alive',
                            'content-type': 'application/x-www-form-urlencoded;charset=UTF-8'
                        },
                        body: postParams.toString()
                    })
                )
            )
            .returns(() => Promise.resolve(mockSessionResponseBad.object));
        when(requestCreator.getFetchMethod()).thenReturn(fetchMock.object as any);

        let result = await jupyterPasswordConnect.getPasswordConnectionInfo({
            url: 'http://TESTNAME:8888/',
            isTokenEmpty: true,
            handle: '1234'
        });
        assert(!result.remappedBaseUrl, 'First call to get password should have failed');
        assert(!result.remappedToken, 'First call to get password should have failed');
        assert(!result.requestHeaders, 'First call to get password should have failed');

        // Now set our input for the correct password
        when(appShell.showInputBox(anything())).thenReturn(Promise.resolve('Python'));

        // Mock our second call to get session cookie with the correct password 'Python'
        const mockSessionResponse = typemoq.Mock.ofType(nodeFetch.Response);
        const mockSessionHeaders = typemoq.Mock.ofType(nodeFetch.Headers);
        mockSessionHeaders
            .setup((mh) => mh.raw())
            .returns(() => {
                return {
                    'set-cookie': [`${sessionName}=${sessionValue}`]
                };
            });
        mockSessionResponse.setup((mr) => mr.status).returns(() => 302);
        mockSessionResponse.setup((mr) => mr.headers).returns(() => mockSessionHeaders.object);

        postParams = new URLSearchParams();
        postParams.append('_xsrf', '12341234');
        postParams.append('password', 'Python');

        // typemoq doesn't love this comparison, so generalize it a bit
        fetchMock
            .setup((fm) =>
                fm(
                    'http://TESTNAME:8888/login?',
                    typemoq.It.isObjectWith({
                        method: 'post',
                        headers: {
                            Cookie: `_xsrf=${xsrfValue}`,
                            Connection: 'keep-alive',
                            'content-type': 'application/x-www-form-urlencoded;charset=UTF-8'
                        },
                        body: postParams.toString()
                    })
                )
            )
            .returns(() => Promise.resolve(mockSessionResponse.object));
        when(requestCreator.getFetchMethod()).thenReturn(fetchMock.object as any);

        // Retry the password
        result = await jupyterPasswordConnect.getPasswordConnectionInfo({
            url: 'http://TESTNAME:8888/',
            isTokenEmpty: true,
            handle: '1234'
        });
        assert(result, 'Expected to get a result on the second call');

        // Verfiy calls
        mockXsrfHeaders.verifyAll();
        mockSessionHeaders.verifyAll();
        mockXsrfResponse.verifyAll();
        mockSessionResponse.verifyAll();
        fetchMock.verifyAll();
    });
});
