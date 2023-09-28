// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ConfigurationTarget } from 'vscode';
import { IApplicationShell } from '../../platform/common/application/types';
import {
    IAsyncDisposableRegistry,
    IConfigurationService,
    IDisposable,
    IDisposableRegistry
} from '../../platform/common/types';
import { DataScience } from '../../platform/common/utils/localize';
import { noop } from '../../platform/common/utils/misc';
import { IMultiStepInputFactory, IMultiStepInput } from '../../platform/common/utils/multiStepInput';
import { traceVerbose, traceWarning } from '../../platform/logging';
import { sendTelemetryEvent, Telemetry } from '../../telemetry';
import {
    IJupyterRequestAgentCreator,
    IJupyterRequestCreator,
    IJupyterServerUriStorage,
    JupyterServerProviderHandle
} from '../../kernels/jupyter/types';
import { dispose } from '../../platform/common/helpers';

export interface IJupyterPasswordConnectInfo {
    requiresPassword: boolean;
    requestHeaders?: Record<string, string>;
    remappedBaseUrl?: string;
    remappedToken?: string;
}

/**
 * Responsible for intercepting connections to a remote server and asking for a password if necessary
 */
export class JupyterHubPasswordConnect {
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
        this.serverUriStorage.onDidRemove(this.onDidRemoveServers, this, this.disposables);
    }
    public async getPasswordConnectionInfo(options: {
        url: string;
        displayName?: string;
        handle: string;
        validationErrorMessage?: string;
        disposables?: IDisposable[];
    }): Promise<IJupyterPasswordConnectInfo> {
        if (!options.url || options.url.length < 1) {
            throw new Error('Invalid URL');
        }

        if (!(await this.isJupyterHub(options.url))) {
            throw new Error('Not a Jupyter Hub Url');
        }
        // Add on a trailing slash to our URL if it's not there already
        const newUrl = addTrailingSlash(options.url);
        const disposables = options.disposables || [];
        const disposeOnDone = !Array.isArray(options.disposables);

        // See if we already have this data. Don't need to ask for a password more than once. (This can happen in remote when listing kernels)
        let result = this.savedConnectInfo.get(options.handle);
        if (!result) {
            result = this.getJupyterHubConnectionInfo(newUrl, options.validationErrorMessage).then((value) => {
                if (!value || (value.requiresPassword && Object.keys(value).length === 1)) {
                    // If we fail to get a valid password connect info, don't save the value
                    traceWarning(`Password for ${newUrl} was invalid.`);
                    this.savedConnectInfo.delete(options.handle);
                }

                return value;
            });
            result.catch(() => this.savedConnectInfo.delete(options.handle));
            result
                .finally(() => {
                    if (disposeOnDone) {
                        dispose(disposables);
                    }
                })
                .catch(noop);
            this.savedConnectInfo.set(options.handle, result);
        }

        return result;
    }
    public async isJupyterHub(url: string): Promise<boolean> {
        try {
            // See this for the different REST endpoints:
            // https://jupyterhub.readthedocs.io/en/stable/_static/rest-api/index.html

            // If we have a token, then user is just connecting to a jupyter server (even if it may be on jupyterhub)
            if (url.toLowerCase().includes('/user/') && url.includes('token=')) {
                return false;
            }
            // If the URL has the /user/ option in it, it's likely this is jupyter hub
            if (url.toLowerCase().includes('/user/') && !url.includes('token=')) {
                return true;
            }

            // Otherwise request hub/api. This should return the json with the hub version
            // if this is a hub url
            const response = await this.makeRequest(new URL('hub/api', addTrailingSlash(url)).toString(), {
                method: 'get'
            });
            // Assume we are at the login page for jupyterlab, which means we're not a jupyter hub
            // Sending this request with the /hub/api appended, still ends up going to the same loging page.
            // Hence status of 200 check is not sufficient.
            if (response.status !== 200) {
                return false;
            }
            // Ensure we get a valid JSON with a version in it.
            try {
                const json = await response.json();
                traceVerbose(`JupyterHub version is ${json && json.version} for url ${url}`);
                return json && json.version;
            } catch {
                //
            }
            return false;
        } catch (ex) {
            traceVerbose(`Error in detecting whether url is isJupyterHub: ${ex}`);
            return false;
        }
    }

    private async getJupyterHubConnectionInfo(
        uri: string,
        validationErrorMessage?: string
    ): Promise<IJupyterPasswordConnectInfo> {
        try {
            // First ask for the user name and password
            const userNameAndPassword = await this.getUserNameAndPassword(validationErrorMessage);
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

    private async getUserNameAndPassword(validationMessage?: string): Promise<{ username: string; password: string }> {
        const multistep = this.multiStepFactory.create<{
            username: string;
            password: string;
            validationMessage?: string;
        }>();
        const state = { username: '', password: '', validationMessage };
        await multistep.run(this.getUserNameMultiStep.bind(this), state);
        return state;
    }

    private async getUserNameMultiStep(
        input: IMultiStepInput<{ username: string; password: string; validationErrorMessage?: string }>,
        state: { username: string; password: string; validationMessage?: string }
    ) {
        state.username = await input.showInputBox({
            title: DataScience.jupyterSelectUserAndPasswordTitle,
            prompt: DataScience.jupyterSelectUserPrompt,
            validate: this.validateUserNameOrPassword,
            validationMessage: state.validationMessage,
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
    private onDidRemoveServers(servers: JupyterServerProviderHandle[]) {
        servers.forEach((server) => {
            if (server.id.startsWith('_builtin')) {
                this.savedConnectInfo.delete(server.handle);
            }
        });
    }
}

function addTrailingSlash(url: string): string {
    let newUrl = url;
    if (newUrl[newUrl.length - 1] !== '/') {
        newUrl = `${newUrl}/`;
    }
    return newUrl;
}
