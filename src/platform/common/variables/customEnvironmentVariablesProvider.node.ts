// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, optional } from 'inversify';
import * as path from '../../vscode-path/path';
import { ConfigurationChangeEvent, Disposable, Event, EventEmitter, RelativePattern, Uri } from 'vscode';
import { TraceOptions } from '../../logging/types';
import { sendFileCreationTelemetry } from '../../telemetry/envFileTelemetry.node';
import { IWorkspaceService } from '../application/types';
import { IDisposableRegistry, Resource } from '../types';
import { InMemoryCache } from '../utils/cacheUtils';
import { EnvironmentVariables, ICustomEnvironmentVariablesProvider, IEnvironmentVariablesService } from './types';
import { traceDecoratorVerbose, traceError, traceInfoIfCI, traceVerbose } from '../../logging';
import { SystemVariables } from './systemVariables.node';
import { disposeAllDisposables } from '../helpers';
import { IPythonExtensionChecker } from '../../api/types';

const CACHE_DURATION = 60 * 1000;
/**
 * Given a URI, computes the environment variables needed to launch an interpreter. Takes into account the .env file or the python.envFile setting.
 */
@injectable()
export class CustomEnvironmentVariablesProvider implements ICustomEnvironmentVariablesProvider, Disposable {
    public get onDidEnvironmentVariablesChange(): Event<Uri | undefined> {
        return this.changeEventEmitter.event;
    }
    public trackedWorkspaceFolders = new Set<string>();
    private fileWatchers = new Set<string>();
    private disposables: Disposable[] = [];
    private changeEventEmitter = new EventEmitter<Uri | undefined>();
    constructor(
        @inject(IEnvironmentVariablesService) private envVarsService: IEnvironmentVariablesService,
        @inject(IDisposableRegistry) disposableRegistry: Disposable[],
        @inject(IWorkspaceService) private workspaceService: IWorkspaceService,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject('number') @optional() private cacheDuration: number = CACHE_DURATION
    ) {
        disposableRegistry.push(this);
        this.workspaceService.onDidChangeConfiguration(this.configurationChanged, this, this.disposables);
    }

    public dispose() {
        this.changeEventEmitter.dispose();
        disposeAllDisposables(this.disposables);
    }

    @traceDecoratorVerbose('Get Custom Env Variables', TraceOptions.BeforeCall | TraceOptions.Arguments)
    public async getEnvironmentVariables(
        resource: Resource,
        purpose: 'RunPythonCode' | 'RunNonPythonCode'
    ): Promise<EnvironmentVariables> {
        resource = resource
            ? resource
            : this.workspaceService.workspaceFolders?.length
            ? this.workspaceService.workspaceFolders[0].uri
            : undefined;

        // Cache resource specific interpreter data
        const cacheStoreIndexedByWorkspaceFolder = new InMemoryCache<EnvironmentVariables>(
            this.cacheDuration,
            this.getCacheKeyForMergedVars(resource, purpose)
        );

        if (cacheStoreIndexedByWorkspaceFolder.hasData && cacheStoreIndexedByWorkspaceFolder.data) {
            traceVerbose(`Cached data exists getEnvironmentVariables, ${resource ? resource.fsPath : '<No Resource>'}`);
            return cacheStoreIndexedByWorkspaceFolder.data!;
        }
        const promise = this._getEnvironmentVariables(resource, purpose);
        promise.then((result) => (cacheStoreIndexedByWorkspaceFolder.data = result)).ignoreErrors();
        return promise;
    }
    public async getCustomEnvironmentVariables(
        resource: Resource,
        purpose: 'RunPythonCode' | 'RunNonPythonCode'
    ): Promise<EnvironmentVariables | undefined> {
        resource = resource
            ? resource
            : this.workspaceService.workspaceFolders?.length
            ? this.workspaceService.workspaceFolders[0].uri
            : undefined;

        // Cache resource specific interpreter data
        const cacheStoreIndexedByWorkspaceFolder = new InMemoryCache<EnvironmentVariables>(
            this.cacheDuration,
            this.getCacheKeyForCustomVars(resource, purpose)
        );

        if (cacheStoreIndexedByWorkspaceFolder.hasData) {
            traceVerbose(
                `Cached custom vars data exists getCustomEnvironmentVariables, ${
                    resource ? resource.fsPath : '<No Resource>'
                }`
            );
            return cacheStoreIndexedByWorkspaceFolder.data!;
        }

        const workspaceFolderUri = this.getWorkspaceFolderUri(resource);
        if (!workspaceFolderUri) {
            traceInfoIfCI(`No workspace folder found for ${resource ? resource.fsPath : '<No Resource>'}`);
            return;
        }
        this.trackedWorkspaceFolders.add(workspaceFolderUri.fsPath || '');

        const envFile = this.getEnvFile(workspaceFolderUri, purpose);
        this.createFileWatcher(envFile, workspaceFolderUri);

        const promise = this.envVarsService.parseFile(envFile, process.env);
        promise.then((result) => (cacheStoreIndexedByWorkspaceFolder.data = result)).ignoreErrors();
        return promise;
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
        const key = this.getCacheKeyForMergedVars(workspaceFolderUri, 'RunNonPythonCode');
        if (this.fileWatchers.has(key)) {
            return;
        }
        const pattern = new RelativePattern(Uri.file(path.dirname(envFile)), path.basename(envFile));
        const envFileWatcher = this.workspaceService.createFileSystemWatcher(pattern, false, false, false);
        if (envFileWatcher) {
            this.disposables.push(envFileWatcher);
            this.fileWatchers.add(key);
            envFileWatcher.onDidChange(() => this.onEnvironmentFileChanged(workspaceFolderUri), this, this.disposables);
            envFileWatcher.onDidCreate(() => this.onEnvironmentFileCreated(workspaceFolderUri), this, this.disposables);
            envFileWatcher.onDidDelete(() => this.onEnvironmentFileChanged(workspaceFolderUri), this, this.disposables);
        } else {
            traceError('Failed to create file watcher for environment file');
        }
    }
    private getEnvFile(workspaceFolderUri: Uri, purpose: 'RunPythonCode' | 'RunNonPythonCode') {
        if (purpose === 'RunPythonCode') {
            return this.getPythonEnvFile(workspaceFolderUri) || path.join(workspaceFolderUri.fsPath, '.env');
        } else {
            return path.join(workspaceFolderUri.fsPath, '.env');
        }
    }
    private getPythonEnvFile(resource?: Uri): string | undefined {
        if (!this.extensionChecker.isPythonExtensionInstalled) {
            return;
        }
        const workspaceFolderUri = this.getWorkspaceFolderUri(resource);
        const sysVars = new SystemVariables(resource, workspaceFolderUri, this.workspaceService);
        const pythonEnvSetting = this.workspaceService.getConfiguration('python', resource).get<string>('envFile');
        return pythonEnvSetting ? sysVars.resolve(pythonEnvSetting) : undefined;
    }
    private async _getEnvironmentVariables(
        resource: Resource,
        purpose: 'RunPythonCode' | 'RunNonPythonCode'
    ): Promise<EnvironmentVariables> {
        let customEnvVars = await this.getCustomEnvironmentVariables(resource, purpose);
        if (!customEnvVars) {
            customEnvVars = {};
        }
        const mergedVars: EnvironmentVariables = {};
        this.envVarsService.mergeVariables(process.env, mergedVars); // Copy current proc vars into new obj.
        this.envVarsService.mergeVariables(customEnvVars!, mergedVars); // Copy custom vars over into obj.
        this.envVarsService.mergePaths(process.env, mergedVars);
        if (process.env.PYTHONPATH) {
            mergedVars.PYTHONPATH = process.env.PYTHONPATH;
        }
        let pathKey = customEnvVars ? Object.keys(customEnvVars).find((k) => k.toLowerCase() == 'path') : undefined;
        if (pathKey && customEnvVars![pathKey]) {
            this.envVarsService.appendPath(mergedVars!, customEnvVars![pathKey]!);
        }
        if (customEnvVars!.PYTHONPATH) {
            this.envVarsService.appendPythonPath(mergedVars!, customEnvVars!.PYTHONPATH);
        }
        return mergedVars;
    }
    private getWorkspaceFolderUri(resource?: Uri): Uri | undefined {
        const workspaceFolders = this.workspaceService.workspaceFolders || [];
        const defaultWorkspaceFolderUri = workspaceFolders.length === 1 ? workspaceFolders[0].uri : undefined;
        if (!resource) {
            return defaultWorkspaceFolderUri;
        }
        // Possible user opens a file outside the workspace folder, in this case load .env file from workspace folder as the fallback.
        return this.workspaceService.getWorkspaceFolder(resource!)?.uri || defaultWorkspaceFolderUri;
    }

    private onEnvironmentFileCreated(workspaceFolderUri?: Uri) {
        this.onEnvironmentFileChanged(workspaceFolderUri);
        sendFileCreationTelemetry();
    }

    private onEnvironmentFileChanged(workspaceFolderUri: Resource) {
        new InMemoryCache<EnvironmentVariables>(
            this.cacheDuration,
            this.getCacheKeyForMergedVars(workspaceFolderUri, 'RunNonPythonCode')
        ).clear();
        new InMemoryCache<EnvironmentVariables>(
            this.cacheDuration,
            this.getCacheKeyForMergedVars(workspaceFolderUri, 'RunPythonCode')
        ).clear();

        new InMemoryCache<EnvironmentVariables>(
            this.cacheDuration,
            this.getCacheKeyForCustomVars(workspaceFolderUri, 'RunNonPythonCode')
        ).clear();
        new InMemoryCache<EnvironmentVariables>(
            this.cacheDuration,
            this.getCacheKeyForCustomVars(workspaceFolderUri, 'RunPythonCode')
        ).clear();

        this.changeEventEmitter.fire(workspaceFolderUri);
    }
    private getCacheKeyForMergedVars(workspaceFolderUri: Resource, purpose: 'RunPythonCode' | 'RunNonPythonCode') {
        return `${this.workspaceService.getWorkspaceFolderIdentifier(workspaceFolderUri)}:${purpose || ''}`;
    }
    private getCacheKeyForCustomVars(workspaceFolderUri: Resource, purpose: 'RunPythonCode' | 'RunNonPythonCode') {
        return `${this.workspaceService.getWorkspaceFolderIdentifier(workspaceFolderUri)}:${purpose || ''}:CustomVars`;
    }
}
