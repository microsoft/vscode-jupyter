// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Subscription } from 'rxjs/Subscription';
import { Disposable, Uri } from 'vscode';
import { IConfigurationService, IDisposable } from '../../../platform/common/types';
import { traceError, traceWarning, traceVerbose } from '../../../platform/logging';
import { ObservableExecutionResult, Output } from '../../../platform/common/process/types.node';
import { createDeferred } from '../../../platform/common/utils/async';
import { DataScience } from '../../../platform/common/utils/localize';
import { IServiceContainer } from '../../../platform/ioc/types';
import { JVSC_EXTENSION_ID, RegExpValues } from '../../../platform/common/constants';
import { JupyterConnectError } from '../../../platform/errors/jupyterConnectError';
import { IJupyterConnection } from '../../types';
import { IJupyterRequestAgentCreator, IJupyterRequestCreator, JupyterServerInfo } from '../types';
import { getJupyterConnectionDisplayName } from '../helpers';
import { arePathsSame } from '../../../platform/common/platform/fileUtils';
import { getFilePath } from '../../../platform/common/platform/fs-paths';
import { JupyterNotebookNotInstalled } from '../../../platform/errors/jupyterNotebookNotInstalled';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { JupyterCannotBeLaunchedWithRootError } from '../../../platform/errors/jupyterCannotBeLaunchedWithRootError';
import { createJupyterConnectionInfo } from '../jupyterUtils';

const urlMatcher = new RegExp(RegExpValues.UrlPatternRegEx);

/**
 * When starting a local jupyter server, this object waits for the server to come up.
 */
export class JupyterConnectionWaiter implements IDisposable {
    private startPromise = createDeferred<IJupyterConnection>();
    private launchTimeout: NodeJS.Timer | number;
    private output = '';
    private subscriptions: Subscription[] = [];
    public readonly ready = this.startPromise.promise;

    constructor(
        private readonly launchResult: ObservableExecutionResult<string>,
        private readonly notebookDir: Uri,
        private readonly rootDir: Uri,
        private readonly getServerInfo: () => Promise<JupyterServerInfo[] | undefined>,
        private readonly serviceContainer: IServiceContainer,
        private readonly interpreter: PythonEnvironment | undefined
    ) {
        // We want to reject our Jupyter connection after a specific timeout
        const configService = serviceContainer.get<IConfigurationService>(IConfigurationService);
        const jupyterLaunchTimeout = configService.getSettings(undefined).jupyterLaunchTimeout;

        this.launchTimeout = setTimeout(() => {
            if (!this.startPromise.completed) {
                this.rejectStartPromise(DataScience.jupyterLaunchTimedOut);
            }
        }, jupyterLaunchTimeout);

        // Listen for crashes
        let exitCode = 0;
        if (launchResult.proc) {
            launchResult.proc.on('exit', (c) => (exitCode = c ? c : 0));
        }
        // Listen on stderr for its connection information
        this.subscriptions.push(
            launchResult.out.subscribe(
                (output: Output<string>) => {
                    traceVerbose(output.out);
                    this.output += output.out;
                    if (RegExpValues.HttpPattern.exec(this.output) && !this.startPromise.completed) {
                        // .then so that we can keep from pushing aync up to the subscribed observable function
                        this.getServerInfo()
                            .then((serverInfos) => this.getJupyterURL(serverInfos, this.output))
                            .catch((ex) => traceWarning('Failed to get server info', ex));
                    }

                    // Sometimes jupyter will return a 403 error. Not sure why. We used
                    // to fail on this, but it looks like jupyter works with this error in place.
                },
                (e) => this.rejectStartPromise(e),
                // If the process dies, we can't extract connection information.
                () => this.rejectStartPromise(DataScience.jupyterServerCrashed(exitCode))
            )
        );
    }
    public dispose() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        clearTimeout(this.launchTimeout as any);
        this.subscriptions.forEach((d) => d.unsubscribe());
    }

    // From a list of jupyter server infos try to find the matching jupyter that we launched
    private getJupyterURL(serverInfos: JupyterServerInfo[] | undefined, data: string) {
        if (serverInfos && serverInfos.length > 0 && !this.startPromise.completed) {
            const matchInfo = serverInfos.find((info) => {
                return arePathsSame(getFilePath(this.notebookDir), getFilePath(Uri.file(info.notebook_dir)));
            });
            if (matchInfo) {
                const url = matchInfo.url;
                const token = matchInfo.token;
                this.resolveStartPromise(url, token);
            }
        }
        // At this point we failed to get the server info or a matching server via the python code, so fall back to
        // our URL parse
        if (!this.startPromise.completed) {
            const urlMatch = urlMatcher.exec(data);
            const groups = urlMatch?.groups;
            if (!this.startPromise.completed && groups && (groups.LOCAL || groups.IP)) {
                // Rebuild the URI from our group hits
                const host = groups.LOCAL ? groups.LOCAL : groups.IP;
                const uriString = `${groups.PREFIX}${host}${groups.REST}`;

                let url: URL;
                try {
                    url = new URL(uriString);
                } catch (err) {
                    traceError(`Failed to parse ${uriString}`, err);
                    // Failed to parse the url either via server infos or the string
                    this.rejectStartPromise(DataScience.jupyterLaunchNoURL);
                    return;
                }

                // For more recent versions of Jupyter the web pages are served from `/tree` and the api is at the root.
                const pathName = url.pathname.endsWith('/tree') ? url.pathname.replace('/tree', '') : url.pathname;
                // Here we parsed the URL correctly
                this.resolveStartPromise(`${url.protocol}//${url.host}${pathName}`, `${url.searchParams.get('token')}`);
            }
        }
    }

    private resolveStartPromise(baseUrl: string, token: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        clearTimeout(this.launchTimeout as any);
        if (!this.startPromise.rejected) {
            const configService = this.serviceContainer.get<IConfigurationService>(IConfigurationService);
            const requestCreator = this.serviceContainer.get<IJupyterRequestCreator>(IJupyterRequestCreator);
            const requestAgentCreator = this.serviceContainer.get<IJupyterRequestAgentCreator | undefined>(
                IJupyterRequestAgentCreator
            );
            const connection = createJupyterConnectionInfo(
                {
                    handle: '',
                    id: '_builtin.jupyterServerLauncher',
                    extensionId: JVSC_EXTENSION_ID
                },
                {
                    baseUrl,
                    token,
                    displayName: getJupyterConnectionDisplayName(token, baseUrl)
                },
                requestCreator,
                requestAgentCreator,
                configService,
                this.rootDir,
                new Disposable(() => this.launchResult.dispose())
            );
            this.startPromise.resolve(connection);
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private rejectStartPromise(message: string | Error) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        clearTimeout(this.launchTimeout as any);
        if (!this.startPromise.resolved) {
            message = typeof message === 'string' ? message : message.message;
            let error: Error;
            const stderr = this.output;
            if (stderr.includes('Jupyter command `jupyter-notebook` not found')) {
                error = new JupyterNotebookNotInstalled(message, stderr, this.interpreter);
            } else if (stderr.includes('Running as root is not recommended. Use --allow-root to bypass')) {
                error = new JupyterCannotBeLaunchedWithRootError(message, stderr, this.interpreter);
            } else {
                error = new JupyterConnectError(message, stderr, this.interpreter);
            }
            this.startPromise.reject(error);
        }
    }
}
