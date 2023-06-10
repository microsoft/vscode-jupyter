// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, optional } from 'inversify';
import { CancellationError, ConfigurationTarget } from 'vscode';
import { IApplicationShell } from '../../platform/common/application/types';
import { IConfigurationService, IDisposableRegistry } from '../../platform/common/types';
import { DataScience } from '../../platform/common/utils/localize';
import { traceWarning } from '../../platform/logging';
import { sendTelemetryEvent, Telemetry } from '../../telemetry';
import {
    IJupyterRequestAgentCreator,
    IJupyterRequestCreator,
    IJupyterServerUriEntry,
    IJupyterServerUriStorage,
    JupyterServerProviderHandle
} from '../../kernels/jupyter/types';
import { Deferred, createDeferred } from '../../platform/common/utils/async';
import { jupyterServerHandleToString } from '../../kernels/jupyter/jupyterUtils';
import { IJupyterPasswordConnect, IJupyterPasswordConnectInfo } from './types';

/**
 * Responsible for intercepting connections to a remote server and asking for a password if necessary
 */
@injectable()
export class JupyterPasswordConnect implements IJupyterPasswordConnect {
    private savedConnectInfo = new Map<string, Promise<IJupyterPasswordConnectInfo>>();
    constructor(
        @inject(IApplicationShell) private appShell: IApplicationShell,
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(IJupyterRequestAgentCreator)
        @optional()
        private readonly agentCreator: IJupyterRequestAgentCreator | undefined,
        @inject(IJupyterRequestCreator) private readonly requestCreator: IJupyterRequestCreator,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry
    ) {
        // Sign up to see if servers are removed from our uri storage list
        this.serverUriStorage.onDidRemove(this.onDidRemoveUris, this, this.disposables);
    }
    private static _prompt?: Deferred<void>;
    public static get prompt(): Promise<void> | undefined {
        return JupyterPasswordConnect._prompt?.promise;
    }
    public getPasswordConnectionInfo({
        url,
        isTokenEmpty,
        serverHandle,
        displayName
    }: {
        url: string;
        isTokenEmpty: boolean;
        serverHandle: JupyterServerProviderHandle;
        displayName?: string;
    }): Promise<IJupyterPasswordConnectInfo> {
        JupyterPasswordConnect._prompt = undefined;
        // Add on a trailing slash to our URL if it's not there already
        const newUrl = addTrailingSlash(url);
        const id = jupyterServerHandleToString(serverHandle);
        // See if we already have this data. Don't need to ask for a password more than once. (This can happen in remote when listing kernels)
        let result = this.savedConnectInfo.get(id);
        if (!result) {
            const deferred = (JupyterPasswordConnect._prompt = createDeferred());
            result = this.getJupyterConnectionInfo({ url: newUrl, isTokenEmpty, displayName }).then((value) => {
                if (!value) {
                    // If we fail to get a valid password connect info, don't save the value
                    traceWarning(`Password for ${newUrl} was invalid.`);
                    this.savedConnectInfo.delete(id);
                }

                return value;
            });
            result.finally(() => {
                deferred.resolve();
                if (JupyterPasswordConnect._prompt === deferred) {
                    JupyterPasswordConnect._prompt = undefined;
                }
            });
            result.catch(() => {
                if (this.savedConnectInfo.get(id) === result) {
                    this.savedConnectInfo.delete(id);
                }
            });
            this.savedConnectInfo.set(id, result);
        }

        return result;
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
            let userPassword: undefined | string;
            if (requiresPassword && isTokenEmpty) {
                let friendlyUrl = url;
                const uri = new URL(url);
                friendlyUrl = `${uri.protocol}//${uri.hostname}`;
                friendlyUrl = displayName ? `${displayName} (${friendlyUrl})` : friendlyUrl;
                userPassword = await this.appShell.showInputBox({
                    title: DataScience.jupyterSelectPasswordTitle(friendlyUrl),
                    prompt: DataScience.jupyterSelectPasswordPrompt,
                    ignoreFocusOut: true,
                    password: true
                });
                if (typeof userPassword === undefined && !userPassword && isTokenEmpty) {
                    // User exited out of the processes, same as hitting ESC.
                    throw new CancellationError();
                }
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
            const requestInit = this.addAllowUnauthorized(url, allowUnauthorized ? true : false, options);
            const result = await this.requestCreator.getFetchMethod()(url, requestInit);
            return result;
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
        uriEntries.forEach((uriEntry) =>
            this.savedConnectInfo.delete(jupyterServerHandleToString(uriEntry.serverHandle))
        );
    }
}

function addTrailingSlash(url: string): string {
    let newUrl = url;
    if (newUrl[newUrl.length - 1] !== '/') {
        newUrl = `${newUrl}/`;
    }
    return newUrl;
}
