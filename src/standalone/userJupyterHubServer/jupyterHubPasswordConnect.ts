// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ConfigurationTarget, window } from 'vscode';
import { IConfigurationService } from '../../platform/common/types';
import { DataScience } from '../../platform/common/utils/localize';
import { logger } from '../../platform/logging';
import { sendTelemetryEvent, Telemetry } from '../../telemetry';
import { IJupyterRequestAgentCreator, IJupyterRequestCreator } from '../../kernels/jupyter/types';

/**
 * Responsible for intercepting connections to a remote server and asking for a password if necessary
 */
export class JupyterHubPasswordConnect {
    constructor(
        private readonly configService: IConfigurationService,
        private readonly agentCreator: IJupyterRequestAgentCreator | undefined,
        private readonly requestCreator: IJupyterRequestCreator
    ) {}
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
                logger.trace(`JupyterHub version is ${json && json.version} for url ${url}`);
                return json && json.version;
            } catch {
                //
            }
            return false;
        } catch (ex) {
            logger.debug(`Error in detecting whether url is isJupyterHub: ${ex}`);
            return false;
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
                const value = await window.showErrorMessage(
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
}

function addTrailingSlash(url: string): string {
    let newUrl = url;
    if (newUrl[newUrl.length - 1] !== '/') {
        newUrl = `${newUrl}/`;
    }
    return newUrl;
}
