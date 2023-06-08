// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { ConfigurationTarget, WorkspaceConfiguration } from 'vscode';
import { IWorkspaceService } from '../../common/application/types';
import { IExtensionSyncActivationService } from '../../activation/types';
import { noop } from '../../common/utils/misc';

@injectable()
export class PythonEnvFilterSettingMigration implements IExtensionSyncActivationService {
    constructor(@inject(IWorkspaceService) private readonly workspace: IWorkspaceService) {}
    public activate() {
        this.migrateFilters().catch(noop);
    }
    private async migrateFilters() {
        // If user opened a mult-root workspace with multiple folders then combine them all.
        // As there's no way to provide controllers per folder.
        const workspaceFolders = Array.isArray(this.workspace.workspaceFolders) ? this.workspace.workspaceFolders : [];
        await this.migrateWorkspaceFilters(
            this.workspace.getConfiguration('jupyter', undefined),
            ConfigurationTarget.Global
        );
        if (workspaceFolders.length === 0) {
            await this.migrateWorkspaceFilters(
                this.workspace.getConfiguration('jupyter', undefined),
                ConfigurationTarget.Global
            );
        } else if (workspaceFolders.length === 1) {
            await this.migrateWorkspaceFilters(
                this.workspace.getConfiguration('jupyter', workspaceFolders[0].uri),
                ConfigurationTarget.WorkspaceFolder
            );
        } else {
            await this.migrateWorkspaceFilters(
                this.workspace.getConfiguration('jupyter', undefined),
                ConfigurationTarget.Workspace
            );
            await Promise.all(
                workspaceFolders.map((workspaceFolder) =>
                    this.migrateWorkspaceFilters(
                        this.workspace.getConfiguration('jupyter', workspaceFolder.uri),
                        ConfigurationTarget.WorkspaceFolder
                    )
                )
            );
        }
    }
    private async migrateWorkspaceFilters(
        jupyterWorkspaceConfig: WorkspaceConfiguration,
        configurationTarget: ConfigurationTarget
    ) {
        const result = jupyterWorkspaceConfig.inspect<OldInterpreterFilter[]>('kernels.filter');
        let filters: OldInterpreterFilter[] = [];
        switch (configurationTarget) {
            case ConfigurationTarget.Global:
                filters = result?.globalValue || [];
                break;
            case ConfigurationTarget.Workspace:
                filters = result?.workspaceValue || [];
                break;
            default:
                filters = result?.workspaceFolderValue || [];
        }
        const interpreterPaths = filters.filter((item) => item.type === 'pythonEnvironment').map((item) => item.path);
        if (filters.length) {
            await jupyterWorkspaceConfig.update('kernels.filter', undefined, configurationTarget);
        }
        if (interpreterPaths.length) {
            await jupyterWorkspaceConfig.update(
                'kernels.excludePythonEnvironments',
                Array.from(new Set(interpreterPaths)),
                configurationTarget
            );
        }
    }
}

type OldInterpreterFilter = {
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
