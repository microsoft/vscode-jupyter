// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationError, ConfigurationTarget } from 'vscode';
import { IApplicationShell } from '../../platform/common/application/types';
import { IAsyncDisposableRegistry, IConfigurationService, IDisposableRegistry } from '../../platform/common/types';
import { DataScience } from '../../platform/common/utils/localize';
import { noop } from '../../platform/common/utils/misc';
import { IMultiStepInputFactory, IMultiStepInput } from '../../platform/common/utils/multiStepInput';
import { traceWarning } from '../../platform/logging';
import { sendTelemetryEvent, Telemetry } from '../../telemetry';
import {
    IJupyterRequestAgentCreator,
    IJupyterRequestCreator,
    IJupyterServerUriEntry,
    IJupyterServerUriStorage
} from '../../kernels/jupyter/types';
import { Deferred, createDeferred } from '../../platform/common/utils/async';

export interface IJupyterPasswordConnectInfo {
    requiresPassword: boolean;
    requestHeaders?: Record<string, string>;
    remappedBaseUrl?: string;
    remappedToken?: string;
}

/**
 * Responsible for intercepting connections to a remote server and asking for a password if necessary
 */
export class JupyterPasswordConnect {
    private savedConnectInfo = new Map<string, Promise<IJupyterPasswordConnectInfo>>();
    constructor(
        private appShell: IApplicationShell,

        private readonly multiStepFactory: IMultiStepInputFactory,
        private readonly asyncDisposableRegistry: IAsyncDisposableRegistry,
        private readonly configService: IConfigurationService,
        private readonly agentCreator: IJupyterRequestAgentCreator | undefined,
        private readonly requestCreator: IJupyterRequestCreator,
        private readonly serverUriStorage: IJupyterServerUriStorage,
        private readonly disposables: IDisposableRegistry
    ) {
        // Sign up to see if servers are removed from our uri storage list
        this.serverUriStorage.onDidRemove(this.onDidRemoveUris, this, this.disposables);
    }
    private static _prompt?: Deferred<void>;
    public static get prompt(): Promise<void> | undefined {
        return JupyterPasswordConnect._prompt?.promise;
    }
    public getPasswordConnectionInfo({
        handle,
        url,
        isTokenEmpty,
        displayName
    }: {
        handle: string;
        url: string;
        isTokenEmpty: boolean;
        displayName?: string;
    }): Promise<IJupyterPasswordConnectInfo> {
        JupyterPasswordConnect._prompt = undefined;
        if (!url || url.length < 1) {
            throw new Error('Invalid URL');
        }

        // Add on a trailing slash to our URL if it's not there already
        const newUrl = addTrailingSlash(url);

        // See if we already have this data. Don't need to ask for a password more than once. (This can happen in remote when listing kernels)
        let result = this.savedConnectInfo.get(handle);
        if (!result) {
            const deferred = (JupyterPasswordConnect._prompt = createDeferred());
            result = this.getNonCachedPasswordConnectionInfo({ url: newUrl, isTokenEmpty, displayName }).then(
                (value) => {
                    if (!value) {
                        // If we fail to get a valid password connect info, don't save the value
                        traceWarning(`Password for ${newUrl} was invalid.`);
                        this.savedConnectInfo.delete(handle);
                    }

                    return value;
                }
            );
            result.finally(() => {
                deferred.resolve();
                if (JupyterPasswordConnect._prompt === deferred) {
                    JupyterPasswordConnect._prompt = undefined;
                }
            });
            this.savedConnectInfo.set(handle, result);
        }

        return result;
    }

    private async getNonCachedPasswordConnectionInfo(options: {
        url: string;
        isTokenEmpty: boolean;
        displayName?: string;
    }): Promise<IJupyterPasswordConnectInfo> {
        // If jupyter hub, go down a special path of asking jupyter hub for a token
        if (await this.isJupyterHub(options.url)) {
            return this.getJupyterHubConnectionInfo(options.url);
        } else {
            return this.getJupyterConnectionInfo(options);
        }
    }

    private async getJupyterHubConnectionInfo(uri: string): Promise<IJupyterPasswordConnectInfo> {
        try {
            // First ask for the user name and password
            const userNameAndPassword = await this.getUserNameAndPassword();
            if (userNameAndPassword.username || userNameAndPassword.password) {
                // Try the login method. It should work and doesn't require a token to be generated.
                let result = await this.getJupyterHubConnectionInfoFromLogin(
                    uri,
                    userNameAndPassword.username,
                    userNameAndPassword.password
                );

                // If login method fails, try generating a token
                if (result) {
                    const failed = Object.keys(result || {}).length === 0;
                    const info = failed ? 'emptyResponseFromLogin' : 'gotResponseFromLogin';
                    sendTelemetryEvent(Telemetry.CheckPasswordJupyterHub, undefined, {
                        failed,
                        info
                    });
                } else {
                    sendTelemetryEvent(Telemetry.CheckPasswordJupyterHub, undefined, {
                        failed: true,
                        info: 'emptyResponseFromLogin'
                    });
                    result = await this.getJupyterHubConnectionInfoFromApi(
                        uri,
                        userNameAndPassword.username,
                        userNameAndPassword.password
                    );
                    const failed = Object.keys(result || {}).length === 0;
                    const info = failed ? 'emptyResponseFromApi' : 'gotResponseFromApi';
                    sendTelemetryEvent(Telemetry.CheckPasswordJupyterHub, undefined, {
                        failed,
                        info
                    });
                }

                return result;
            }
            sendTelemetryEvent(Telemetry.CheckPasswordJupyterHub, undefined, {
                failed: false,
                info: 'passwordNotRequired'
            });
            return {
                requiresPassword: false
            };
        } catch (ex) {
            sendTelemetryEvent(Telemetry.CheckPasswordJupyterHub, undefined, { failed: true, info: 'failure' });
            throw ex;
        }
    }

    private async getJupyterHubConnectionInfoFromLogin(
        uri: string,
        username: string,
        password: string
    ): Promise<IJupyterPasswordConnectInfo | undefined> {
        // We're using jupyter hub. Get the base url
        const url = new URL(uri);
        const baseUrl = `${url.protocol}//${url.host}`;

        const postParams = new URLSearchParams();
        postParams.append('username', username || '');
        postParams.append('password', password || '');

        let response = await this.makeRequest(`${baseUrl}/hub/login?next=`, {
            method: 'POST',
            headers: {
                Connection: 'keep-alive',
                Referer: `${baseUrl}/hub/login`,
                'content-type': 'application/x-www-form-urlencoded;charset=UTF-8'
            },
            body: postParams.toString(),
            redirect: 'manual'
        });

        // The cookies from that response should be used to make the next set of requests
        if (response && response.status === 302) {
            const cookies = this.getCookies(response);
            const cookieString = [...cookies.entries()].reduce((p, c) => `${p};${c[0]}=${c[1]}`, '');
            // See this API for creating a token
            // https://jupyterhub.readthedocs.io/en/stable/_static/rest-api/index.html#operation--users--name--tokens-post
            response = await this.makeRequest(`${baseUrl}/hub/api/users/${username}/tokens`, {
                method: 'POST',
                headers: {
                    Connection: 'keep-alive',
                    Cookie: cookieString,
                    Referer: `${baseUrl}/hub/login`
                }
            });

            // That should give us a new token. For now server name is hard coded. Not sure
            // how to fetch it other than in the info for a default token
            if (response.ok && response.status === 200) {
                const body = await response.json();
                if (body && body.token && body.id) {
                    // Response should have the token to use for this user.

                    // Make sure the server is running for this user. Don't need
                    // to check response as it will fail if already running.
                    // https://jupyterhub.readthedocs.io/en/stable/_static/rest-api/index.html#operation--users--name--server-post
                    await this.makeRequest(`${baseUrl}/hub/api/users/${username}/server`, {
                        method: 'POST',
                        headers: {
                            Connection: 'keep-alive',
                            Cookie: cookieString,
                            Referer: `${baseUrl}/hub/login`
                        }
                    });

                    // This token was generated for this request. We should clean it up when
                    // the user closes VS code
                    this.asyncDisposableRegistry.push({
                        dispose: async () => {
                            this.makeRequest(`${baseUrl}/hub/api/users/${username}/tokens/${body.id}`, {
                                method: 'DELETE',
                                headers: {
                                    Connection: 'keep-alive',
                                    Cookie: cookieString,
                                    Referer: `${baseUrl}/hub/login`
                                }
                            }).catch(noop); // Don't wait for this during shutdown. Just make the request
                        }
                    });

                    return {
                        requestHeaders: {},
                        remappedBaseUrl: `${baseUrl}/user/${username}`,
                        remappedToken: body.token,
                        requiresPassword: true
                    };
                }
            }
        }
    }

    private async getJupyterHubConnectionInfoFromApi(
        uri: string,
        username: string,
        password: string
    ): Promise<IJupyterPasswordConnectInfo> {
        // We're using jupyter hub. Get the base url
        const url = new URL(uri);
        const baseUrl = `${url.protocol}//${url.host}`;
        // Use these in a post request to get the token to use
        const response = await this.makeRequest(
            `${baseUrl}/hub/api/authorizations/token`, // This seems to be deprecated, but it works. It requests a new token
            {
                method: 'POST',
                headers: {
                    Connection: 'keep-alive',
                    'content-type': 'application/json;charset=UTF-8'
                },
                body: `{ "username": "${username || ''}", "password": "${password || ''}"  }`,
                redirect: 'manual'
            }
        );

        if (response.ok && response.status === 200) {
            const body = await response.json();
            if (body && body.user && body.user.server && body.token) {
                // Response should have the token to use for this user.
                return {
                    requestHeaders: {},
                    remappedBaseUrl: `${baseUrl}${body.user.server}`,
                    remappedToken: body.token,
                    requiresPassword: true
                };
            }
        }
        return {
            requiresPassword: false
        };
    }

    private async getJupyterConnectionInfo({
        url,
        isTokenEmpty,
        displayName
    }: {
        url: string;
        isTokenEmpty: boolean;
        displayName?: string;
    }): Promise<IJupyterPasswordConnectInfo> {
        let xsrfCookie: string | undefined;
        let sessionCookieName: string | undefined;
        let sessionCookieValue: string | undefined;

        // First determine if we need a password. A request for the base URL with /tree? should return a 302 if we do.
        const requiresPassword = await this.needPassword(url);

        if (requiresPassword || isTokenEmpty) {
            // Get password first
            let friendlyUrl = url;
            const uri = new URL(url);
            friendlyUrl = `${uri.protocol}//${uri.hostname}`;
            friendlyUrl = displayName ? `${displayName} (${friendlyUrl})` : friendlyUrl;
            const userPassword =
                requiresPassword && isTokenEmpty
                    ? await this.appShell.showInputBox({
                          title: DataScience.jupyterSelectPasswordTitle(friendlyUrl),
                          prompt: DataScience.jupyterSelectPasswordPrompt,
                          ignoreFocusOut: true,
                          password: true
                      })
                    : undefined;

            if (typeof userPassword === undefined && !userPassword && isTokenEmpty) {
                // User exited out of the processes, same as hitting ESC.
                throw new CancellationError();
            }

            // If we do not have a password, but token is empty, then generate an xsrf token with session cookie
            if (userPassword || isTokenEmpty) {
                xsrfCookie = await this.getXSRFToken(url, '');

                // Then get the session cookie by hitting that same page with the xsrftoken and the password
                if (xsrfCookie) {
                    const sessionResult = await this.getSessionCookie(url, xsrfCookie, userPassword || '');
                    sessionCookieName = sessionResult.sessionCookieName;
                    sessionCookieValue = sessionResult.sessionCookieValue;
                } else {
                    // Special case for Kubeflow, see https://github.com/microsoft/vscode-jupyter/issues/8441
                    // get xsrf cookie with session cookie
                    sessionCookieName = 'authservice_session';
                    sessionCookieValue = userPassword;

                    xsrfCookie = await this.getXSRFToken(url, `${sessionCookieName}=${sessionCookieValue}`);
                }
            } else {
                // If userPassword is undefined or '' then the user didn't pick a password. In this case return back that we should just try to connect
                // like a standard connection. Might be the case where there is no token and no password
                return { requiresPassword };
            }
        } else {
            // If no password needed, act like empty password and no cookie
            return { requiresPassword };
        }

        // If we found everything return it all back if not, undefined as partial is useless
        // Remember session cookie can be empty, if both token and password are empty
        if (xsrfCookie && sessionCookieName && (sessionCookieValue || isTokenEmpty)) {
            sendTelemetryEvent(Telemetry.GetPasswordSuccess);
            const cookieString = `_xsrf=${xsrfCookie}; ${sessionCookieName}=${sessionCookieValue || ''}`;
            const requestHeaders = { Cookie: cookieString, 'X-XSRFToken': xsrfCookie };
            return { requestHeaders, requiresPassword };
        } else {
            sendTelemetryEvent(Telemetry.GetPasswordFailure);
            return { requiresPassword };
        }
    }

    /**
     * For HTTPS connections respect our allowUnauthorized setting by adding in an agent to enable that on the request
     */
    private addAllowUnauthorized(url: string, allowUnauthorized: boolean, options: RequestInit): RequestInit {
        if (url.startsWith('https') && allowUnauthorized && this.agentCreator) {
            const requestAgent = this.agentCreator.createHttpRequestAgent();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return { ...options, agent: requestAgent } as any;
        }

        return options;
    }

    private async getUserNameAndPassword(): Promise<{ username: string; password: string }> {
        const multistep = this.multiStepFactory.create<{ username: string; password: string }>();
        const state = { username: '', password: '' };
        await multistep.run(this.getUserNameMultiStep.bind(this), state);
        return state;
    }

    private async getUserNameMultiStep(
        input: IMultiStepInput<{ username: string; password: string }>,
        state: { username: string; password: string }
    ) {
        state.username = await input.showInputBox({
            title: DataScience.jupyterSelectUserAndPasswordTitle,
            prompt: DataScience.jupyterSelectUserPrompt,
            validate: this.validateUserNameOrPassword,
            value: ''
        });
        if (state.username) {
            return this.getPasswordMultiStep.bind(this);
        }
    }

    private async validateUserNameOrPassword(_value: string): Promise<string | undefined> {
        return undefined;
    }

    private async getPasswordMultiStep(
        input: IMultiStepInput<{ username: string; password: string }>,
        state: { username: string; password: string }
    ) {
        state.password = await input.showInputBox({
            title: DataScience.jupyterSelectUserAndPasswordTitle,
            prompt: DataScience.jupyterSelectPasswordPrompt,
            validate: this.validateUserNameOrPassword,
            value: '',
            password: true
        });
    }

    private async getXSRFToken(url: string, sessionCookie: string): Promise<string | undefined> {
        let xsrfCookie: string | undefined;
        let headers;
        let tokenUrl = `${url}login?`;

        if (sessionCookie != '') {
            tokenUrl = `${url}tree`;
            headers = {
                Connection: 'keep-alive',
                Cookie: sessionCookie
            };
        } else {
            headers = {
                Connection: 'keep-alive'
            };
        }

        const response = await this.makeRequest(tokenUrl, {
            method: 'get',
            redirect: 'manual',
            headers
        });

        if (response !== undefined && response.ok) {
            const cookies = this.getCookies(response);
            if (cookies.has('_xsrf')) {
                xsrfCookie = cookies.get('_xsrf')?.split(';')[0];
            }
        }

        return xsrfCookie;
    }

    private async needPassword(url: string): Promise<boolean> {
        // A jupyter server will redirect if you ask for the tree when a login is required
        const response = await this.makeRequest(`${url}tree?`, {
            method: 'get',
            redirect: 'manual',
            headers: { Connection: 'keep-alive' }
        });

        return response.status !== 200;
    }

    private async makeRequest(url: string, options: RequestInit): Promise<Response> {
        const allowUnauthorized = this.configService.getSettings(undefined).allowUnauthorizedRemoteConnection;

        // Try once and see if it fails with unauthorized.
        try {
            return await this.requestCreator.getFetchMethod()(
                url,
                this.addAllowUnauthorized(url, allowUnauthorized ? true : false, options)
            );
        } catch (e) {
            if (e.message.indexOf('reason: self signed certificate') >= 0) {
                // Ask user to change setting and possibly try again.
                const enableOption: string = DataScience.jupyterSelfCertEnable;
                const closeOption: string = DataScience.jupyterSelfCertClose;
                const value = await this.appShell.showErrorMessage(
                    DataScience.jupyterSelfCertFail(e.message),
                    { modal: true },
                    enableOption,
                    closeOption
                );
                if (value === enableOption) {
                    sendTelemetryEvent(Telemetry.SelfCertsMessageEnabled);
                    await this.configService.updateSetting(
                        'allowUnauthorizedRemoteConnection',
                        true,
                        undefined,
                        ConfigurationTarget.Workspace
                    );
                    return this.requestCreator.getFetchMethod()(url, this.addAllowUnauthorized(url, true, options));
                } else if (value === closeOption) {
                    sendTelemetryEvent(Telemetry.SelfCertsMessageClose);
                }
            }
            throw e;
        }
    }

    private async isJupyterHub(url: string): Promise<boolean> {
        // See this for the different REST endpoints:
        // https://jupyterhub.readthedocs.io/en/stable/_static/rest-api/index.html

        // If the URL has the /user/ option in it, it's likely this is jupyter hub
        if (url.toLowerCase().includes('/user/')) {
            return true;
        }

        // Otherwise request hub/api. This should return the json with the hub version
        // if this is a hub url
        const response = await this.makeRequest(`${url}hub/api`, {
            method: 'get',
            redirect: 'manual',
            headers: { Connection: 'keep-alive' }
        });

        return response.status === 200;
    }

    /**
     * Jupyter uses a session cookie to validate so by hitting the login page with the password we can get that cookie and use it ourselves
     * This workflow can be seen by running fiddler and hitting the login page with a browser
     * First you need a get at the login page to get the xsrf token, then you send back that token along with the password in a post
     * That will return back the session cookie. This session cookie then needs to be added to our requests and websockets for @jupyterlab/services
     */
    private async getSessionCookie(
        url: string,
        xsrfCookie: string,
        password: string
    ): Promise<{ sessionCookieName: string | undefined; sessionCookieValue: string | undefined }> {
        let sessionCookieName: string | undefined;
        let sessionCookieValue: string | undefined;
        // Create the form params that we need
        const postParams = new URLSearchParams();
        postParams.append('_xsrf', xsrfCookie);
        postParams.append('password', password);

        const response = await this.makeRequest(`${url}login?`, {
            method: 'post',
            headers: {
                Cookie: `_xsrf=${xsrfCookie}`,
                Connection: 'keep-alive',
                'content-type': 'application/x-www-form-urlencoded;charset=UTF-8'
            },
            body: postParams.toString(),
            redirect: 'manual'
        });

        // Now from this result we need to extract the session cookie
        if (response.status === 302) {
            const cookies = this.getCookies(response);

            // Session cookie is the first one
            if (cookies.size > 0) {
                sessionCookieName = cookies.entries().next().value[0];
                sessionCookieValue = cookies.entries().next().value[1];
            }
        }

        return { sessionCookieName, sessionCookieValue };
    }

    private getCookies(response: Response): Map<string, string> {
        const cookieList: Map<string, string> = new Map<string, string>();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = (response.headers as any).raw ? (response.headers as any).raw() : response.headers;

        const cookies = raw['set-cookie'];

        if (cookies) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            cookies.forEach((value: any) => {
                const cookieKey = value.substring(0, value.indexOf('='));
                const cookieVal = value.substring(value.indexOf('=') + 1);
                cookieList.set(cookieKey, cookieVal);
            });
        }

        return cookieList;
    }

    /**
     * When URIs are removed from the server list also remove them from
     */
    private onDidRemoveUris(uriEntries: IJupyterServerUriEntry[]) {
        uriEntries.forEach((uriEntry) => this.savedConnectInfo.delete(uriEntry.provider.handle));
    }
}

function addTrailingSlash(url: string): string {
    let newUrl = url;
    if (newUrl[newUrl.length - 1] !== '/') {
        newUrl = `${newUrl}/`;
    }
    return newUrl;
}
