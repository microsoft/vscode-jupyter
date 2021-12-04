// import { INotebookControllerManager } from './types';

import { inject, injectable } from 'inversify';
import { ConfigurationTarget, EventEmitter } from 'vscode';
import { IWorkspaceService } from '../../../common/application/types';
import { disposeAllDisposables } from '../../../common/helpers';
import { traceVerbose } from '../../../common/logger';
import { IConfigurationService, IDisposable, IDisposableRegistry, IPathUtils } from '../../../common/types';
import { KernelConnectionMetadata } from '../../jupyter/kernels/types';

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
        @inject(IDisposableRegistry) disposales: IDisposableRegistry,
        @inject(IPathUtils) private readonly pathUtils: IPathUtils
    ) {
        disposales.push(this);
    }
    public dispose() {
        this._onDidChange.dispose();
        disposeAllDisposables(this.disposables);
    }
    public isKernelHidden(kernelConnection: KernelConnectionMetadata): boolean {
        const hiddenList = this.getFilters();
        if (kernelConnection.kind === 'connectToLiveKernel' || kernelConnection.kind === 'startUsingRemoteKernelSpec') {
            return false;
        }
        return hiddenList.some((item) => {
            if (
                kernelConnection.kind === 'startUsingLocalKernelSpec' &&
                item.type === 'jupyterKernelspec' &&
                kernelConnection.kernelSpec.specFile
            ) {
                return (
                    item.path.toLowerCase() ===
                    this.pathUtils.getDisplayName(kernelConnection.kernelSpec.specFile).toLowerCase()
                );
            }
            if (kernelConnection.kind === 'startUsingPythonInterpreter' && item.type === 'pythonEnvironment') {
                return (
                    item.path.toLowerCase() ===
                    this.pathUtils.getDisplayName(kernelConnection.interpreter.path).toLowerCase()
                );
            }
            return false;
        });
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
                if (!filter || duplicates.has(filter?.path)) {
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
        if (connection.kind === 'connectToLiveKernel') {
            traceVerbose('Hiding default or live kernels via filter is not supported');
            return;
        }
        if (connection.kind === 'startUsingLocalKernelSpec' && connection.kernelSpec.specFile) {
            return <KernelSpecFiter>{
                path: this.pathUtils.getDisplayName(connection.kernelSpec.specFile),
                type: 'jupyterKernelspec'
            };
        } else if (connection.kind === 'startUsingPythonInterpreter') {
            return <InterpreterFiter>{
                path: this.pathUtils.getDisplayName(connection.interpreter.path),
                type: 'pythonEnvironment'
            };
        }
    }
}

type KernelFilter = KernelSpecFiter | InterpreterFiter;
type KernelSpecFiter = {
    type: 'jupyterKernelspec';
    /**
     * Can contain paths prefixed with `~`
     * Can contain paths with / even when on windows.
     * Paths defined here can be case insensitive and path seprators can be either / or \
     * We need to ensure these paths are portable from machine to machine (users syncing their settings).
     * E.g. `~/miniconda3/envs/wow/share/jupyter/kernels/misc/kernelspec.json`
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
