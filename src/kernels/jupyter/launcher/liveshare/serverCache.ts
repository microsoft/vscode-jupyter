// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import '../../../../platform/common/extensions';

import { CancellationToken } from 'vscode';
import { traceError, traceVerbose } from '../../../../platform/logging';
import { IAsyncDisposable } from '../../../../platform/common/types';
import { sleep } from '../../../../platform/common/utils/async';
import { INotebookServerOptions, INotebookServer } from '../../types';

interface IServerData {
    options: INotebookServerOptions;
    promise: Promise<INotebookServer>;
    resolved: boolean;
}

/**
 * Cache of connections to notebook servers.
 */
export class ServerCache implements IAsyncDisposable {
    private cache: Map<string, IServerData> = new Map<string, IServerData>();
    private disposed = false;

    public clearCache() {
        this.cache.clear();
    }

    public async getOrCreate(
        createFunction: (options: INotebookServerOptions, cancelToken: CancellationToken) => Promise<INotebookServer>,
        options: INotebookServerOptions,
        cancelToken: CancellationToken
    ): Promise<INotebookServer> {
        const fixedOptions = await this.generateDefaultOptions(options);
        const key = this.generateKey(fixedOptions);
        let data: IServerData | undefined;

        // Check to see if we already have a promise for this key
        data = this.cache.get(key);

        if (!data) {
            // Didn't find one, so start up our promise and cache it
            data = {
                promise: createFunction(options, cancelToken),
                options: fixedOptions,
                resolved: false
            };
            this.cache.set(key, data);
        }

        return data.promise
            .then((server: INotebookServer) => {
                // Change the dispose on it so we
                // can detach from the server when it goes away.
                const oldDispose = server.dispose.bind(server);
                server.dispose = () => {
                    this.cache.delete(key);
                    return oldDispose();
                };

                // We've resolved the promise at this point
                if (data) {
                    data.resolved = true;
                }

                return server;
            })
            .catch((e) => {
                this.cache.delete(key);
                throw e;
            });
    }

    public async get(options: INotebookServerOptions): Promise<INotebookServer | undefined> {
        const fixedOptions = await this.generateDefaultOptions(options);
        const key = this.generateKey(fixedOptions);
        if (this.cache.has(key)) {
            return this.cache.get(key)?.promise;
        }
    }

    public async dispose(): Promise<void> {
        if (!this.disposed) {
            this.disposed = true;
            const entries = [...this.cache.values()];
            this.cache.clear();
            await Promise.all(
                entries.map(async (d) => {
                    try {
                        // This should be quick. The server is either already up or will never come back.
                        const server = await Promise.race([d.promise, sleep(1000)]);
                        if (typeof server !== 'number') {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            await (server as any).dispose();
                        } else {
                            traceVerbose('ServerCache Dispose, no server');
                        }
                    } catch (e) {
                        traceError(`Dispose error in ServerCache: `, e);
                    }
                })
            );
        }
    }

    public async generateDefaultOptions(options: INotebookServerOptions): Promise<INotebookServerOptions> {
        if (options.localJupyter) {
            return {
                resource: options?.resource,
                ui: options.ui,
                localJupyter: true
            };
        }
        return {
            serverId: options.serverId,
            resource: options?.resource,
            ui: options.ui,
            localJupyter: false
        };
    }

    private generateKey(options: INotebookServerOptions): string {
        // combine all the values together to make a unique key
        return `serverId=${options.localJupyter ? '' : options.serverId};local=${options.localJupyter};`;
    }
}
