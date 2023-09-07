// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationError, ConfigurationTarget, QuickInputButtons } from 'vscode';
import { IApplicationShell } from '../../platform/common/application/types';
import { IConfigurationService, IDisposable, IDisposableRegistry } from '../../platform/common/types';
import { DataScience } from '../../platform/common/utils/localize';
import { noop } from '../../platform/common/utils/misc';
import { InputFlowAction } from '../../platform/common/utils/multiStepInput';
import { traceWarning } from '../../platform/logging';
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
export class JupyterPasswordConnect {
    private savedConnectInfo = new Map<string, Promise<IJupyterPasswordConnectInfo>>();
    constructor(
        private appShell: IApplicationShell,

        private readonly configService: IConfigurationService,
        private readonly agentCreator: IJupyterRequestAgentCreator | undefined,
        private readonly requestCreator: IJupyterRequestCreator,
        private readonly serverUriStorage: IJupyterServerUriStorage,
        private readonly disposables: IDisposableRegistry
    ) {
        // Sign up to see if servers are removed from our uri storage list
        this.serverUriStorage.onDidRemove(this.onDidRemoveServers, this, this.disposables);
    }
    public getPasswordConnectionInfo(options: {
        url: string;
        isTokenEmpty: boolean;
        displayName?: string;
        handle: string;
        validationErrorMessage?: string;
        disposables?: IDisposable[];
    }): Promise<IJupyterPasswordConnectInfo> {
        if (!options.url || options.url.length < 1) {
            throw new Error('Invalid URL');
        }

        // Add on a trailing slash to our URL if it's not there already
        const newUrl = addTrailingSlash(options.url);
        const disposables = options.disposables || [];
        const disposeOnDone = !Array.isArray(options.disposables);

        // See if we already have this data. Don't need to ask for a password more than once. (This can happen in remote when listing kernels)
        let result = this.savedConnectInfo.get(options.handle);
        if (!result) {
            result = this.getJupyterConnectionInfo({
                url: newUrl,
                isTokenEmpty: options.isTokenEmpty,
                displayName: options.displayName,
                disposables,
                validationErrorMessage: options.validationErrorMessage
            }).then((value) => {
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

    /**
     * The input prompts created here are not disposed and hidden immediately.
     * The idea is that the workflow that requires this method to prompt for password
     * will return with the prompt displayed and then if the password is invalid or the like,
     * we can call this method once again and display a new quick pick avoiding flickers.
     *
     * Similarly, if there's another quick pick or input box that needs to be displayed after this method,
     * leaving this UI open will avoid flickers.
     *
     * The disposables array is eventually disposed by the calling method.
     */
    private async getJupyterConnectionInfo(options: {
        url: string;
        isTokenEmpty: boolean;
        displayName?: string;
        validationErrorMessage?: string;
        disposables: IDisposable[];
    }): Promise<IJupyterPasswordConnectInfo> {
        let xsrfCookie: string | undefined;
        let sessionCookieName: string | undefined;
        let sessionCookieValue: string | undefined;
        let userPassword: string | undefined = undefined;

        // First determine if we need a password. A request for the base URL with /tree? should return a 302 if we do.
        const requiresPassword = await this.needPassword(options.url);

        if (requiresPassword || options.isTokenEmpty) {
            // Get password first
            let friendlyUrl = options.url;
            const uri = new URL(options.url);
            friendlyUrl = `${uri.protocol}//${uri.hostname}`;
            friendlyUrl = options.displayName ? `${options.displayName} (${friendlyUrl})` : friendlyUrl;
            if (requiresPassword && options.isTokenEmpty) {
                const input = this.appShell.createInputBox();
                options.disposables.push(input);
                input.title = DataScience.jupyterSelectPasswordTitle(friendlyUrl);
                input.prompt = DataScience.jupyterSelectPasswordPrompt;
                input.ignoreFocusOut = true;
                input.password = true;
                input.validationMessage = options.validationErrorMessage || '';
                input.show();
                input.buttons = [QuickInputButtons.Back];
                userPassword = await new Promise<string>((resolve, reject) => {
                    input.onDidTriggerButton(
                        (e) => {
                            if (e === QuickInputButtons.Back) {
                                reject(InputFlowAction.back);
                            }
                        },
                        this,
                        options.disposables
                    );
                    input.onDidChangeValue(() => (input.validationMessage = ''), this, options.disposables);
                    input.onDidAccept(() => resolve(input.value), this, options.disposables);
                    input.onDidHide(() => reject(InputFlowAction.cancel), this, options.disposables);
                });
            }

            if (typeof userPassword === undefined && !userPassword && options.isTokenEmpty) {
                // User exited out of the processes, same as hitting ESC.
                throw new CancellationError();
            }

            // If we do not have a password, but token is empty, then generate an xsrf token with session cookie
            if (userPassword || options.isTokenEmpty) {
                xsrfCookie = await this.getXSRFToken(options.url, '');

                // Then get the session cookie by hitting that same page with the xsrftoken and the password
                if (xsrfCookie) {
                    const sessionResult = await this.getSessionCookie(options.url, xsrfCookie, userPassword || '');
                    sessionCookieName = sessionResult.sessionCookieName;
                    sessionCookieValue = sessionResult.sessionCookieValue;
                } else {
                    // Special case for Kubeflow, see https://github.com/microsoft/vscode-jupyter/issues/8441
                    // get xsrf cookie with session cookie
                    sessionCookieName = 'authservice_session';
                    sessionCookieValue = userPassword;

                    xsrfCookie = await this.getXSRFToken(options.url, `${sessionCookieName}=${sessionCookieValue}`);
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
        if (xsrfCookie && sessionCookieName && (sessionCookieValue || options.isTokenEmpty)) {
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
        let tokenUrl = new URL('login?', addTrailingSlash(url)).toString();

        if (sessionCookie != '') {
            tokenUrl = new URL('tree', addTrailingSlash(url)).toString();
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
        const response = await this.makeRequest(new URL('tree?', addTrailingSlash(url)).toString(), {
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

        const response = await this.makeRequest(new URL('login?', addTrailingSlash(url)).toString(), {
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
    private onDidRemoveServers(servers: JupyterServerProviderHandle[]) {
        servers.forEach((server) => {
            if (server.id.startsWith('_builtin')) {
                this.savedConnectInfo.delete(server.handle);
            }
        });
    }
}

export function addTrailingSlash(url: string): string {
    let newUrl = url;
    if (newUrl[newUrl.length - 1] !== '/') {
        newUrl = `${newUrl}/`;
    }
    return newUrl;
}
