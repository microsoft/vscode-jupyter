// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from 'assert';
import * as nodeFetch from 'node-fetch';
import * as typemoq from 'typemoq';

import { anything, instance, mock, when } from 'ts-mockito';
import { ApplicationShell } from '../../../platform/common/application/applicationShell';
import { AsyncDisposableRegistry } from '../../../platform/common/asyncDisposableRegistry';
import { ConfigurationService } from '../../../platform/common/configuration/service.node';
import { MultiStepInputFactory } from '../../../platform/common/utils/multiStepInput';
import { MockInputBox } from '../../../test/datascience/mockInputBox';
import { MockQuickPick } from '../../../test/datascience/mockQuickPick';
import { JupyterPasswordConnect } from './jupyterPasswordConnect';
import { JupyterRequestCreator } from '../session/jupyterRequestCreator.node';
import { IJupyterRequestCreator, IJupyterServerUriStorage } from '../types';
import { IDisposableRegistry } from '../../../platform/common/types';

/* eslint-disable @typescript-eslint/no-explicit-any, ,  */
suite('JupyterPasswordConnect', () => {
    let jupyterPasswordConnect: JupyterPasswordConnect;
    let appShell: ApplicationShell;
    let configService: ConfigurationService;
    let requestCreator: IJupyterRequestCreator;

    const xsrfValue: string = '12341234';
    const sessionName: string = 'sessionName';
    const sessionValue: string = 'sessionValue';

    setup(() => {
        appShell = mock(ApplicationShell);
        when(appShell.showInputBox(anything())).thenReturn(Promise.resolve('Python'));
        const multiStepFactory = new MultiStepInputFactory(instance(appShell));
        const mockDisposableRegistry = mock(AsyncDisposableRegistry);
        configService = mock(ConfigurationService);
        requestCreator = mock(JupyterRequestCreator);
        const serverUriStorage = mock<IJupyterServerUriStorage>();
        const disposables = mock<IDisposableRegistry>();

        jupyterPasswordConnect = new JupyterPasswordConnect(
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

    function createMockSetup(secure: boolean, ok: boolean, xsrfReponseStatusCode: 200 | 302 = 302) {
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
            handle: '1',
            url: 'http://TESTNAME:8888/',
            isTokenEmpty: true
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
            handle: '1',
            url: 'http://TESTNAME:8888/',
            isTokenEmpty: true
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
            handle: '1',
            url: 'https://TESTNAME:8888/',
            isTokenEmpty: true
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
            handle: '1',
            url: 'http://TESTNAME:8888/',
            isTokenEmpty: true
        });
        assert(!result);

        // Verfiy calls
        mockXsrfHeaders.verifyAll();
        mockXsrfResponse.verifyAll();
        fetchMock.verifyAll();
    });

    test('Bad password followed by good password.', async () => {
        // Reconfigure our app shell to first give a bad password
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
            handle: '1',
            url: 'http://TESTNAME:8888/',
            isTokenEmpty: true
        });
        assert(!result, 'First call to get password should have failed');

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
            handle: '1',
            url: 'http://TESTNAME:8888/',
            isTokenEmpty: true
        });
        assert(result, 'Expected to get a result on the second call');

        // Verfiy calls
        mockXsrfHeaders.verifyAll();
        mockSessionHeaders.verifyAll();
        mockXsrfResponse.verifyAll();
        mockSessionResponse.verifyAll();
        fetchMock.verifyAll();
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
            handle: '1',
            url: 'http://TESTNAME:8888/',
            isTokenEmpty: true
        });
        assert.ok(result, 'No hub connection info');
        assert.equal(result?.remappedBaseUrl, 'http://testname:8888/user/test', 'Url not remapped');
        assert.equal(result?.remappedToken, 'foobar', 'Token should be returned in URL');
        assert.ok(result?.requestHeaders, 'No request headers returned for jupyter hub');
    });
});
