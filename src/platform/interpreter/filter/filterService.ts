// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { EventEmitter, Uri } from 'vscode';
import { IWorkspaceService } from '../../common/application/types';
import { dispose } from '../../common/helpers';
import { IDisposable, IDisposableRegistry, IsWebExtension } from '../../common/types';
import { sendTelemetryEvent } from '../../../telemetry';
import { Telemetry } from '../../common/constants';
import { getDisplayPath } from '../../common/platform/fs-paths';
import { traceVerbose } from '../../logging';
import { Environment } from '../../api/pythonApiTypes';

/**
 * Determine whether a Python environment should be excluded from the Kernel filter.
 */
@injectable()
export class PythonEnvironmentFilter implements IDisposable {
    private readonly disposables: IDisposable[] = [];
    private _onDidChange = new EventEmitter<void>();
    public get onDidChange() {
        return this._onDidChange.event;
    }
    constructor(
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IsWebExtension) private readonly webExtension: boolean
    ) {
        disposables.push(this);
        if (!this.webExtension) {
            this.workspace.onDidChangeConfiguration(
                (e) => {
                    e.affectsConfiguration('jupyter.kernels.excludePythonEnvironments') && this._onDidChange.fire();
                },
                this,
                this.disposables
            );
        }
    }
    public dispose() {
        this._onDidChange.dispose();
        dispose(this.disposables);
    }
    public isPythonEnvironmentExcluded(interpreter: { uri: Uri; envPath?: Uri } | Environment): boolean {
        if (this.webExtension) {
            return false;
        }
        const hiddenList = this.getExcludedPythonEnvironments();
        const envFolderUri = 'uri' in interpreter ? interpreter.envPath : interpreter.environment?.folderUri;
        const interpreterUri = 'uri' in interpreter ? interpreter.uri : interpreter.executable.uri;
        if (!interpreterUri && !envFolderUri) {
            return false;
        }
        const hidden = hiddenList.some((item) => {
            /**
             * Filter paths can be prefixed with `~`
             * Filter paths can contain values with / even when on windows.
             * We need to ensure these paths are portable from machine to machine (users syncing their settings).
             * E.g. `~/miniconda3/envs/wow/hello/python`
             * Paths defined here can be case insensitive and path seprators can be either / or \
             */
            const displayPath = getDisplayPath(item.trim()).toLowerCase().replace(/\\/g, '/');
            item = item.trim().toLowerCase().replace(/\\/g, '/');
            if (item.length === 0 || displayPath.length === 0) {
                return false;
            }
            const displayInterpreterPath = getDisplayPath(interpreterUri).toLowerCase().replace(/\\/g, '/');
            // eslint-disable-next-line local-rules/dont-use-fspath
            const interpreterPath = interpreterUri ? interpreterUri.fsPath.toLowerCase().replace(/\\/g, '/') : '';
            if (
                item === displayInterpreterPath ||
                displayPath === displayInterpreterPath ||
                item === interpreterPath ||
                displayPath === interpreterPath
            ) {
                return true;
            }
            // Possible user entered the path to the environment instead of the executable.
            const displayEnvPath = getDisplayPath(envFolderUri || '')
                .toLowerCase()
                .replace(/\\/g, '/');
            const envPath = getDisplayPath(envFolderUri || '')
                .toLowerCase()
                .replace(/\\/g, '/');
            if (
                item === displayEnvPath ||
                displayPath === displayEnvPath ||
                item === envPath ||
                displayPath === envPath
            ) {
                return true;
            }
            return false;
        });

        if (hidden) {
            sendTelemetryEvent(Telemetry.JupyterKernelHiddenViaFilter);
            traceVerbose(`Python Env hidden via filter: ${getDisplayPath(interpreterUri)}`);
        }
        return hidden;
    }
    private getExcludedPythonEnvironments(): string[] {
        // If user opened a mult-root workspace with multiple folders then combine them all.
        // As there's no way to provide controllers per folder.
        if (!this.workspace.workspaceFolders || this.workspace.workspaceFolders.length === 0) {
            return this.workspace
                .getConfiguration('jupyter', undefined)
                .get<string[]>('kernels.excludePythonEnvironments', []);
        }
        const filters: string[] = [];
        this.workspace.workspaceFolders.forEach((item) => {
            filters.push(
                ...this.workspace
                    .getConfiguration('jupyter', item.uri)
                    .get<string[]>('kernels.excludePythonEnvironments', [])
            );
        });
        return filters;
    }
}
