// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import '../../../platform/common/extensions';

import { ChildProcess } from 'child_process';
import { Subscription } from 'rxjs/Subscription';
import { CancellationError, CancellationToken, Disposable, Event, EventEmitter, Uri } from 'vscode';
import { IConfigurationService, IDisposable } from '../../../platform/common/types';
import { Cancellation } from '../../../platform/common/cancellation';
import { traceInfo, traceError, traceWarning } from '../../../platform/logging';
import { ObservableExecutionResult, Output } from '../../../platform/common/process/types.node';
import { Deferred, createDeferred } from '../../../platform/common/utils/async';
import { DataScience } from '../../../platform/common/utils/localize';
import { IServiceContainer } from '../../../platform/ioc/types';
import { RegExpValues } from '../../../platform/common/constants';
import { JupyterConnectError } from '../../../platform/errors/jupyterConnectError';
import { IJupyterConnection } from '../../types';
import { JupyterServerInfo } from '../types';
import { getJupyterConnectionDisplayName } from './helpers';
import { arePathsSame } from '../../../platform/common/platform/fileUtils';
import { getFilePath } from '../../../platform/common/platform/fs-paths';

const urlMatcher = new RegExp(RegExpValues.UrlPatternRegEx);

/**
 * When starting a local jupyter server, this object waits for the server to come up.
 */
export class JupyterConnectionWaiter implements IDisposable {
    private startPromise: Deferred<IJupyterConnection>;
    private launchTimeout: NodeJS.Timer | number;
    private configService: IConfigurationService;
    private stderr: string[] = [];
    private connectionDisposed = false;
    private subscriptions: Subscription[] = [];

    constructor(
        private readonly launchResult: ObservableExecutionResult<string>,
        private readonly notebookDir: Uri,
        private readonly rootDir: Uri,
        private readonly getServerInfo: (cancelToken?: CancellationToken) => Promise<JupyterServerInfo[] | undefined>,
        serviceContainer: IServiceContainer,
        private cancelToken?: CancellationToken
    ) {
        this.configService = serviceContainer.get<IConfigurationService>(IConfigurationService);

        // Cancel our start promise if a cancellation occurs
        if (cancelToken) {
            cancelToken.onCancellationRequested(() => this.startPromise.reject(new CancellationError()));
        }

        // Setup our start promise
        this.startPromise = createDeferred<IJupyterConnection>();

        // We want to reject our Jupyter connection after a specific timeout
        const settings = this.configService.getSettings(undefined);
        const jupyterLaunchTimeout = settings.jupyterLaunchTimeout;

        this.launchTimeout = setTimeout(() => {
            this.launchTimedOut();
        }, jupyterLaunchTimeout);

        // Listen for crashes
        let exitCode = '0';
        if (launchResult.proc) {
            launchResult.proc.on('exit', (c) => (exitCode = c ? c.toString() : '0'));
        }
        let stderr = '';
        // Listen on stderr for its connection information
        this.subscriptions.push(
            launchResult.out.subscribe(
                (output: Output<string>) => {
                    if (output.source === 'stderr') {
                        stderr += output.out;
                        this.stderr.push(output.out);
                        this.extractConnectionInformation(stderr);
                    } else {
                        this.output(output.out);
                    }
                },
                (e) => this.rejectStartPromise(e),
                // If the process dies, we can't extract connection information.
                () => this.rejectStartPromise(DataScience.jupyterServerCrashed().format(exitCode))
            )
        );
    }
    public dispose() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        clearTimeout(this.launchTimeout as any);
        this.subscriptions.forEach((d) => d.unsubscribe());
    }

    public waitForConnection(): Promise<IJupyterConnection> {
        return this.startPromise.promise;
    }

    private createConnection(
        url: string,
        baseUrl: string,
        token: string,
        hostName: string,
        processDisposable: Disposable
    ) {
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        return new JupyterConnection(
            url,
            baseUrl,
            token,
            hostName,
            this.rootDir,
            processDisposable,
            this.launchResult.proc
        );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private output(data: any) {
        if (!this.connectionDisposed) {
            traceInfo(data.toString('utf8'));
        }
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
                const host = matchInfo.hostname;
                this.resolveStartPromise(url, url, token, host);
            }
        }
        // At this point we failed to get the server info or a matching server via the python code, so fall back to
        // our URL parse
        if (!this.startPromise.completed) {
            this.getJupyterURLFromString(data);
        }
    }

    private getJupyterURLFromString(data: string) {
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
                this.rejectStartPromise(DataScience.jupyterLaunchNoURL());
                return;
            }

            // For more recent versions of Jupyter the web pages are served from `/tree` and the api is at the root.
            const pathName = url.pathname.endsWith('/tree') ? url.pathname.replace('/tree', '') : url.pathname;
            // Here we parsed the URL correctly
            this.resolveStartPromise(
                uriString,
                `${url.protocol}//${url.host}${pathName}`,
                `${url.searchParams.get('token')}`,
                url.hostname
            );
        }
    }

    private extractConnectionInformation = (data: string) => {
        this.output(data);

        const httpMatch = RegExpValues.HttpPattern.exec(data);

        if (httpMatch && this.notebookDir && this.startPromise && !this.startPromise.completed && this.getServerInfo) {
            // .then so that we can keep from pushing aync up to the subscribed observable function
            this.getServerInfo(this.cancelToken)
                .then((serverInfos) => this.getJupyterURL(serverInfos, data))
                .catch((ex) => traceWarning('Failed to get server info', ex));
        }

        // Sometimes jupyter will return a 403 error. Not sure why. We used
        // to fail on this, but it looks like jupyter works with this error in place.
    };

    private launchTimedOut = () => {
        if (!this.startPromise.completed) {
            this.rejectStartPromise(DataScience.jupyterLaunchTimedOut());
        }
    };

    private resolveStartPromise(url: string, baseUrl: string, token: string, hostName: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        clearTimeout(this.launchTimeout as any);
        if (!this.startPromise.rejected) {
            const connection = this.createConnection(url, baseUrl, token, hostName, this.launchResult);
            const origDispose = connection.dispose.bind(connection);
            connection.dispose = () => {
                // Stop listening when we disconnect
                this.connectionDisposed = true;
                return origDispose();
            };
            this.startPromise.resolve(connection);
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private rejectStartPromise = (message: string | Error) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        clearTimeout(this.launchTimeout as any);
        if (!this.startPromise.resolved) {
            message = typeof message === 'string' ? message : message.message;
            this.startPromise.reject(
                Cancellation.isCanceled(this.cancelToken)
                    ? new CancellationError()
                    : new JupyterConnectError(message, this.stderr.join('\n'))
            );
        }
    };
}

// Represents an active connection to a running jupyter notebook
class JupyterConnection implements IJupyterConnection {
    public readonly localLaunch: boolean = true;
    public readonly type = 'jupyter';
    private eventEmitter: EventEmitter<number> = new EventEmitter<number>();
    constructor(
        public readonly url: string,
        public readonly baseUrl: string,
        public readonly token: string,
        public readonly hostName: string,
        public readonly rootDirectory: Uri,
        private readonly disposable: Disposable,
        childProc: ChildProcess | undefined
    ) {
        // If the local process exits, set our exit code and fire our event
        if (childProc) {
            childProc.on('exit', (c) => {
                // Our code expects the exit code to be of type `number` or `undefined`.
                const code = typeof c === 'number' ? c : 0;
                this.eventEmitter.fire(code);
            });
        }
    }

    public get displayName(): string {
        return getJupyterConnectionDisplayName(this.token, this.baseUrl);
    }

    public get disconnected(): Event<number> {
        return this.eventEmitter.event;
    }

    public dispose() {
        if (this.disposable) {
            this.disposable.dispose();
        }
    }
}
