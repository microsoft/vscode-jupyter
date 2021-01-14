// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { inject, injectable, optional } from 'inversify';
import * as path from 'path';
import { ConfigurationChangeEvent, Disposable, Event, EventEmitter, FileSystemWatcher, Uri } from 'vscode';
import { sendFileCreationTelemetry } from '../../telemetry/envFileTelemetry';
import { IWorkspaceService } from '../application/types';
import { traceVerbose } from '../logger';
import { IPlatformService } from '../platform/types';
import { IDisposableRegistry } from '../types';
import { InMemoryCache } from '../utils/cacheUtils';
import { EnvironmentVariables, IEnvironmentVariablesProvider, IEnvironmentVariablesService } from './types';

const CACHE_DURATION = 60 * 60 * 1000;
@injectable()
export class EnvironmentVariablesProvider implements IEnvironmentVariablesProvider, Disposable {
    public get onDidEnvironmentVariablesChange(): Event<Uri | undefined> {
        return this.changeEventEmitter.event;
    }
    public trackedWorkspaceFolders = new Set<string>();
    private fileWatchers = new Map<string, FileSystemWatcher>();
    private disposables: Disposable[] = [];
    private changeEventEmitter: EventEmitter<Uri | undefined>;
    constructor(
        @inject(IEnvironmentVariablesService) private envVarsService: IEnvironmentVariablesService,
        @inject(IDisposableRegistry) disposableRegistry: Disposable[],
        @inject(IPlatformService) private platformService: IPlatformService,
        @inject(IWorkspaceService) private workspaceService: IWorkspaceService,
        @optional() private cacheDuration: number = CACHE_DURATION
    ) {
        disposableRegistry.push(this);
        this.changeEventEmitter = new EventEmitter();
        const disposable = this.workspaceService.onDidChangeConfiguration(this.configurationChanged, this);
        this.disposables.push(disposable);
    }

    public dispose() {
        this.changeEventEmitter.dispose();
        this.fileWatchers.forEach((watcher) => {
            if (watcher) {
                watcher.dispose();
            }
        });
    }

    public async getEnvironmentVariables(resource?: Uri): Promise<EnvironmentVariables> {
        // Cache resource specific interpreter data
        const key = this.workspaceService.getWorkspaceFolderIdentifier(resource);
        const cacheStoreIndexedByWorkspaceFolder = new InMemoryCache<EnvironmentVariables>(this.cacheDuration, key);

        if (cacheStoreIndexedByWorkspaceFolder.hasData && cacheStoreIndexedByWorkspaceFolder.data) {
            traceVerbose(`Cached data exists getEnvironmentVariables, ${resource ? resource.fsPath : '<No Resource>'}`);
            return cacheStoreIndexedByWorkspaceFolder.data!;
        }
        const promise = this._getEnvironmentVariables(resource);
        promise.then((result) => (cacheStoreIndexedByWorkspaceFolder.data = result)).ignoreErrors();
        return promise;
    }
    public async getCustomEnvironmentVariables(resource?: Uri): Promise<EnvironmentVariables | undefined> {
        const workspaceFolderUri = this.getWorkspaceFolderUri(resource);
        this.trackedWorkspaceFolders.add(workspaceFolderUri ? workspaceFolderUri.fsPath : '');

        // eslint-disable-next-line
        // TODO: This should be added to the python API (or this entire service should move there)
        // https://github.com/microsoft/vscode-jupyter/issues/51
        const envFile = workspaceFolderUri?.fsPath ? path.join(workspaceFolderUri.fsPath, '.env') : '.env';
        this.createFileWatcher(envFile, workspaceFolderUri);
        return this.envVarsService.parseFile(envFile, process.env);
    }
    public configurationChanged(e: ConfigurationChangeEvent) {
        this.trackedWorkspaceFolders.forEach((item) => {
            const uri = item && item.length > 0 ? Uri.file(item) : undefined;
            if (e.affectsConfiguration('python.envFile', uri)) {
                this.onEnvironmentFileChanged(uri);
            }
        });
    }
    public createFileWatcher(envFile: string, workspaceFolderUri?: Uri) {
        if (this.fileWatchers.has(envFile)) {
            return;
        }
        const envFileWatcher = this.workspaceService.createFileSystemWatcher(envFile);
        this.fileWatchers.set(envFile, envFileWatcher);
        if (envFileWatcher) {
            this.disposables.push(envFileWatcher.onDidChange(() => this.onEnvironmentFileChanged(workspaceFolderUri)));
            this.disposables.push(envFileWatcher.onDidCreate(() => this.onEnvironmentFileCreated(workspaceFolderUri)));
            this.disposables.push(envFileWatcher.onDidDelete(() => this.onEnvironmentFileChanged(workspaceFolderUri)));
        }
    }
    private async _getEnvironmentVariables(resource?: Uri): Promise<EnvironmentVariables> {
        let customEnvVars = await this.getCustomEnvironmentVariables(resource);
        if (!customEnvVars) {
            customEnvVars = {};
        }
        const mergedVars: EnvironmentVariables = {};
        this.envVarsService.mergeVariables(process.env, mergedVars); // Copy current proc vars into new obj.
        this.envVarsService.mergeVariables(customEnvVars!, mergedVars); // Copy custom vars over into obj.
        const pathVariable = this.platformService.pathVariableName;
        if (process.env[pathVariable]) {
            mergedVars[pathVariable] = process.env[pathVariable];
        }
        if (process.env.PYTHONPATH) {
            mergedVars.PYTHONPATH = process.env.PYTHONPATH;
        }
        if (customEnvVars![pathVariable]) {
            this.envVarsService.appendPath(mergedVars!, customEnvVars![pathVariable]!);
        }
        if (customEnvVars!.PYTHONPATH) {
            this.envVarsService.appendPythonPath(mergedVars!, customEnvVars!.PYTHONPATH);
        }
        return mergedVars;
    }
    private getWorkspaceFolderUri(resource?: Uri): Uri | undefined {
        if (!resource) {
            return;
        }
        const workspaceFolder = this.workspaceService.getWorkspaceFolder(resource!);
        return workspaceFolder ? workspaceFolder.uri : undefined;
    }

    private onEnvironmentFileCreated(workspaceFolderUri?: Uri) {
        this.onEnvironmentFileChanged(workspaceFolderUri);
        sendFileCreationTelemetry();
    }

    private onEnvironmentFileChanged(workspaceFolderUri?: Uri) {
        const key = this.workspaceService.getWorkspaceFolderIdentifier(workspaceFolderUri);
        new InMemoryCache<EnvironmentVariables>(this.cacheDuration, `$getEnvironmentVariables-${key}`).clear();

        this.changeEventEmitter.fire(workspaceFolderUri);
    }
}
