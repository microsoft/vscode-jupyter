// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { ConfigurationTarget, EventEmitter, Uri } from 'vscode';
import { IWorkspaceService } from '../../../platform/common/application/types';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { traceVerbose } from '../../../platform/logging';
import { IConfigurationService, IDisposable, IDisposableRegistry } from '../../../platform/common/types';
import { KernelConnectionMetadata } from '../../../kernels/types';
import { sendTelemetryEvent } from '../../../telemetry';
import { Telemetry } from '../../../platform/common/constants';
import { getDisplayPath } from '../../../platform/common/platform/fs-paths';

/**
 * Keeps track of which kernels are filtered or not. Supports local and remote but not 'live' kernels.
 */
@injectable()
export class KernelFilterService implements IDisposable {
    private readonly disposables: IDisposable[] = [];
    private _onDidChange = new EventEmitter<void>();
    public get onDidChange() {
        return this._onDidChange.event;
    }
    constructor(
        @inject(IConfigurationService) private readonly config: IConfigurationService,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(IDisposableRegistry) disposales: IDisposableRegistry
    ) {
        disposales.push(this);
    }
    public dispose() {
        this._onDidChange.dispose();
        disposeAllDisposables(this.disposables);
    }
    public isKernelHidden(kernelConnection: KernelConnectionMetadata): boolean {
        const hiddenList = this.getFilters();
        if (kernelConnection.kind === 'connectToLiveRemoteKernel') {
            return false;
        }
        const hidden = hiddenList.some((item) => {
            if (item.type === 'jupyterKernelspec' && kernelConnection.kernelSpec.specFile) {
                return item.path.toLowerCase() === kernelConnection.kernelSpec.specFile.toLowerCase();
            }
            if (kernelConnection.kind === 'startUsingPythonInterpreter' && item.type === 'pythonEnvironment') {
                return item.path.toLowerCase() === getDisplayPath(kernelConnection.interpreter.uri).toLowerCase();
            }
            if (kernelConnection.kind === 'startUsingRemoteKernelSpec' && item.type === 'remoteKernelSpec') {
                return item.path === `${kernelConnection.kernelSpec.name}${kernelConnection.serverId}`;
            }
            return false;
        });

        if (hidden) {
            sendTelemetryEvent(Telemetry.JupyterKernelHiddenViaFilter);
        }
        return hidden;
    }
    private getFilters(): KernelFilter[] {
        // If user opened a mult-root workspace with multiple folders then combine them all.
        // As there's no way to provide controllers per folder.
        if (!this.workspace.workspaceFolders || this.workspace.workspaceFolders.length === 0) {
            return this.workspace.getConfiguration('jupyter', undefined).get<KernelFilter[]>('kernels.filter', []);
        }
        const filters: KernelFilter[] = [];
        this.workspace.workspaceFolders.forEach((item) => {
            filters.push(
                ...this.workspace.getConfiguration('jupyter', item.uri).get<KernelFilter[]>('kernels.filter', [])
            );
        });
        return filters;
    }
    public async storeHiddenKernels(hiddenKernels: KernelConnectionMetadata[]) {
        const duplicates = new Set<string>();
        const itemsToHide = hiddenKernels
            .map((item) => {
                const filter = this.translateConnectionToFilter(item);
                if (!filter || duplicates.has(filter.path)) {
                    return;
                }
                duplicates.add(filter.path);
                return filter;
            })
            .filter((item) => !!item)
            .map((item) => item!);

        const folders = (this.workspace.workspaceFolders || []).map((item) => item.uri);
        if (folders.length > 0) {
            await Promise.all(
                folders.map((folder) =>
                    this.config.updateSetting('kernels.filter', itemsToHide, folder, ConfigurationTarget.Workspace)
                )
            );
        } else {
            await this.config.updateSetting('kernels.filter', itemsToHide, undefined, ConfigurationTarget.Global);
        }
        this._onDidChange.fire();
    }
    private translateConnectionToFilter(connection: KernelConnectionMetadata): KernelFilter | undefined {
        if (connection.kind === 'connectToLiveRemoteKernel') {
            traceVerbose('Hiding default or live kernels via filter is not supported');
            return;
        }
        if (connection.kind === 'startUsingLocalKernelSpec' && connection.kernelSpec.specFile) {
            return <KernelSpecFiter>{
                path: getDisplayPath(Uri.file(connection.kernelSpec.specFile)),
                type: 'jupyterKernelspec'
            };
        } else if (connection.kind === 'startUsingPythonInterpreter') {
            return <InterpreterFiter>{
                path: getDisplayPath(connection.interpreter.uri),
                type: 'pythonEnvironment'
            };
        } else if (
            connection.kind === 'startUsingRemoteKernelSpec' &&
            connection.kernelSpec.name &&
            connection.serverId
        ) {
            return <RemoteSpecFilter>{
                path: `${connection.kernelSpec.name}${connection.serverId}`,
                type: 'remoteKernelSpec'
            };
        }
    }
}

type KernelFilter = KernelSpecFiter | InterpreterFiter | RemoteSpecFilter;
type KernelSpecFiter = {
    type: 'jupyterKernelspec';
    /**
     * Can contain paths prefixed with `~`
     * Can contain paths with / even when on windows.
     * Paths defined here can be case insensitive and path seprators can be either / or \
     * We need to ensure these paths are portable from machine to machine (users syncing their settings).
     * E.g. `~/miniconda3/envs/wow/share../../kernels/misc/kernelspec.json`
     */
    path: string;
};
type InterpreterFiter = {
    type: 'pythonEnvironment';
    /**
     * Can contain paths prefixed with `~`
     * Can contain paths with / even when on windows.
     * We need to ensure these paths are portable from machine to machine (users syncing their settings).
     * Later we can support multiple OS (via env variables such as $CONDAPATH or the like)
     * E.g. `~/miniconda3/envs/wow/hello/python`
     * Paths defined here can be case insensitive and path seprators can be either / or \
     */
    path: string;
};
type RemoteSpecFilter = {
    type: 'remoteKernelSpec';
    /**
     * Combination of the name and serverid
     */
    path: string;
};
