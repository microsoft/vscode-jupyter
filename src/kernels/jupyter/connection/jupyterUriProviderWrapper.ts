// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { IDisposableRegistry } from '../../../platform/common/types';
import * as localize from '../../../platform/common/utils/localize';
import { IJupyterUriProvider, JupyterServerUriHandle, IJupyterServerUri } from '../types';
import { Telemetry, sendTelemetryEvent } from '../../../telemetry';

const handlesForWhichWeHaveSentTelemetry = new Set<string>();
/**
 * This class wraps an IJupyterUriProvider provided by another extension. It allows us to show
 * extra data on the other extension's UI.
 */
export class JupyterUriProviderWrapper implements IJupyterUriProvider {
    onDidChangeHandles?: vscode.Event<void>;
    getHandles?(): Promise<JupyterServerUriHandle[]>;
    removeHandle?(handle: JupyterServerUriHandle): Promise<void>;

    constructor(
        private readonly provider: IJupyterUriProvider,
        private extensionId: string,
        disposables: IDisposableRegistry
    ) {
        if (provider.onDidChangeHandles) {
            const _onDidChangeHandles = new vscode.EventEmitter<void>();
            this.onDidChangeHandles = _onDidChangeHandles.event.bind(this);

            disposables.push(_onDidChangeHandles);
            disposables.push(
                provider.onDidChangeHandles(() => {
                    _onDidChangeHandles.fire();
                })
            );
        }

        if (provider.getHandles) {
            this.getHandles = async () => {
                return provider.getHandles!();
            };
        }

        if (provider.removeHandle) {
            this.removeHandle = (handle: JupyterServerUriHandle) => {
                return provider.removeHandle!(handle);
            };
        }
    }
    public get id() {
        return this.provider.id;
    }
    public get displayName(): string | undefined {
        return this.provider.displayName;
    }
    public get detail(): string | undefined {
        return this.provider.detail;
    }
    public async getQuickPickEntryItems(): Promise<vscode.QuickPickItem[]> {
        if (!this.provider.getQuickPickEntryItems) {
            return [];
        }
        return (await this.provider.getQuickPickEntryItems()).map((q) => {
            return {
                ...q,
                // Add the package name onto the description
                description: localize.DataScience.uriProviderDescriptionFormat(q.description || '', this.extensionId),
                original: q
            };
        });
    }
    public async handleQuickPick(
        item: vscode.QuickPickItem,
        back: boolean
    ): Promise<JupyterServerUriHandle | 'back' | undefined> {
        if (!this.provider.handleQuickPick) {
            return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((item as any).original) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return this.provider.handleQuickPick((item as any).original, back);
        }
        return this.provider.handleQuickPick(item, back);
    }

    public async getServerUri(handle: JupyterServerUriHandle): Promise<IJupyterServerUri> {
        const server = await this.provider.getServerUri(handle);
        if (!this.id.startsWith('_builtin') && !handlesForWhichWeHaveSentTelemetry.has(handle)) {
            handlesForWhichWeHaveSentTelemetry.add(handle);
            // Need this info to try and remove some of the properties from the API.
            // Before we do that we need to determine what extensions are using which properties.
            const pemUsed: (keyof IJupyterServerUri)[] = [];
            Object.keys(server).forEach((k) => {
                const value = server[k as keyof IJupyterServerUri];
                if (!value) {
                    return;
                }
                if (typeof value === 'object' && Object.keys(value).length === 0 && !(value instanceof Date)) {
                    return;
                }
                pemUsed.push(k as keyof IJupyterServerUri);
            });
            sendTelemetryEvent(Telemetry.JupyterServerProviderResponseApi, undefined, {
                providerId: this.id,
                extensionId: this.extensionId,
                pemUsed
            });
        }
        return server;
    }
}
