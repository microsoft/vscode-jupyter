// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken } from 'vscode';
import { traceError, traceVerbose } from '../../../../platform/logging';
import { IAsyncDisposable, Resource } from '../../../../platform/common/types';
import { sleep } from '../../../../platform/common/utils/async';
import { IJupyterConnection } from '../../../types';

interface IServerData {
    resource: Resource;
    promise: Promise<IJupyterConnection>;
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
        createFunction: (
            resource: Resource,
            cancelToken: CancellationToken
        ) => Promise<IJupyterConnection>,
        resource: Resource,
        cancelToken: CancellationToken
    ): Promise<IJupyterConnection> {
        const key = this.generateKey();
        let data: IServerData | undefined;

        // Check to see if we already have a promise for this key
        data = this.cache.get(key);

        if (!data) {
            // Didn't find one, so start up our promise and cache it
            data = {
                promise: createFunction(resource, cancelToken),
                resource,
                resolved: false
            };
            this.cache.set(key, data);
        }

        return data.promise
            .then((server: IJupyterConnection) => {
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

    public async get(): Promise<IJupyterConnection | undefined> {
        const key = this.generateKey();
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

    private generateKey(): string {
        return `local`;
    }
}
