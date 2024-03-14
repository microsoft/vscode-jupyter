// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, optional } from 'inversify';
import * as path from '../../vscode-path/path';
import { CancellationToken, Disposable, Event, EventEmitter, RelativePattern, Uri, workspace } from 'vscode';
import { TraceOptions } from '../../logging/types';
import { sendFileCreationTelemetry } from '../../telemetry/envFileTelemetry.node';
import { IDisposableRegistry, Resource } from '../types';
import { InMemoryCache } from '../utils/cacheUtils';
import { EnvironmentVariables, ICustomEnvironmentVariablesProvider, IEnvironmentVariablesService } from './types';
import { traceDecoratorVerbose, traceError, traceInfoIfCI, traceVerbose } from '../../logging';
import { dispose } from '../utils/lifecycle';
import { IPythonApiProvider, IPythonExtensionChecker } from '../../api/types';
import { noop } from '../utils/misc';
import { getWorkspaceFolderIdentifier } from '../application/workspace.base';

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
    private pythonEnvVarChangeEventHooked?: boolean;
    constructor(
        @inject(IEnvironmentVariablesService) private envVarsService: IEnvironmentVariablesService,
        @inject(IDisposableRegistry) disposableRegistry: Disposable[],
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IPythonApiProvider) private readonly pythonApi: IPythonApiProvider,
        @inject('number') @optional() private cacheDuration: number = CACHE_DURATION
    ) {
        disposableRegistry.push(this);
    }

    public dispose() {
        this.changeEventEmitter.dispose();
        dispose(this.disposables);
    }

    @traceDecoratorVerbose('Get Custom Env Variables', TraceOptions.Arguments)
    public async getEnvironmentVariables(
        resource: Resource,
        purpose: 'RunPythonCode' | 'RunNonPythonCode',
        token?: CancellationToken
    ): Promise<EnvironmentVariables> {
        resource = resource
            ? resource
            : workspace.workspaceFolders?.length
            ? workspace.workspaceFolders[0].uri
            : undefined;

        if (purpose === 'RunPythonCode') {
            // No need to cache for Python code, as we get these env vars from Python extension.
            return this._getEnvironmentVariables(resource, purpose, token);
        }
        const cacheStoreIndexedByWorkspaceFolder = new InMemoryCache<EnvironmentVariables>(
            this.cacheDuration,
            this.getCacheKeyForMergedVars(resource)
        );

        if (cacheStoreIndexedByWorkspaceFolder.hasData && cacheStoreIndexedByWorkspaceFolder.data) {
            traceVerbose(`Cached data exists getEnvironmentVariables, ${resource ? resource.fsPath : '<No Resource>'}`);
            return cacheStoreIndexedByWorkspaceFolder.data!;
        }
        const promise = this._getEnvironmentVariables(resource, purpose, token);
        promise
            .then((result) => {
                if (!token?.isCancellationRequested) {
                    cacheStoreIndexedByWorkspaceFolder.data = result;
                }
            })
            .catch(noop);
        return promise;
    }
    public async getCustomEnvironmentVariables(
        resource: Resource,
        purpose: 'RunPythonCode' | 'RunNonPythonCode',
        token?: CancellationToken
    ): Promise<EnvironmentVariables | undefined> {
        resource = resource
            ? resource
            : workspace.workspaceFolders?.length
            ? workspace.workspaceFolders[0].uri
            : undefined;
        const workspaceFolderUri = this.getWorkspaceFolderUri(resource);
        if (!workspaceFolderUri) {
            traceInfoIfCI(`No workspace folder found for ${resource ? resource.fsPath : '<No Resource>'}`);
            return;
        }

        if (purpose === 'RunPythonCode' && this.extensionChecker.isPythonExtensionInstalled) {
            const api = await this.pythonApi.getNewApi();
            if (api && !token?.isCancellationRequested) {
                if (!this.pythonEnvVarChangeEventHooked) {
                    this.pythonEnvVarChangeEventHooked = true;
                    api.environments.onDidEnvironmentVariablesChange(
                        (e) => {
                            traceVerbose(`Python env vars changed ${e.resource?.uri?.path}`);
                            this.onEnvironmentFileChanged(e.resource?.uri);
                            this.changeEventEmitter.fire(e.resource?.uri);
                        },
                        this,
                        this.disposables
                    );
                }
                return api.environments.getEnvironmentVariables(workspaceFolderUri);
            }
        }
        // Cache resource specific interpreter data
        const cacheStoreIndexedByWorkspaceFolder = new InMemoryCache<EnvironmentVariables>(
            this.cacheDuration,
            this.getCacheKeyForCustomVars(resource)
        );

        if (cacheStoreIndexedByWorkspaceFolder.hasData) {
            traceVerbose(
                `Cached custom vars data exists getCustomEnvironmentVariables, ${
                    resource ? resource.fsPath : '<No Resource>'
                }`
            );
            return cacheStoreIndexedByWorkspaceFolder.data!;
        }
        if (token?.isCancellationRequested) {
            return;
        }
        this.trackedWorkspaceFolders.add(workspaceFolderUri.fsPath || '');

        const envFile = this.getEnvFile(workspaceFolderUri);
        this.createFileWatcher(envFile, workspaceFolderUri);

        const promise = this.envVarsService.parseFile(envFile, process.env);
        promise
            .then((result) => {
                if (!token?.isCancellationRequested) {
                    cacheStoreIndexedByWorkspaceFolder.data = result;
                }
            })
            .catch(noop);
        return promise;
    }
    public createFileWatcher(envFile: string, workspaceFolderUri?: Uri) {
        const key = this.getCacheKeyForMergedVars(workspaceFolderUri);
        if (this.fileWatchers.has(key)) {
            return;
        }
        const pattern = new RelativePattern(Uri.file(path.dirname(envFile)), path.basename(envFile));
        const envFileWatcher = workspace.createFileSystemWatcher(pattern, false, false, false);
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
    private getEnvFile(workspaceFolderUri: Uri) {
        return path.join(workspaceFolderUri.fsPath, '.env');
    }
    private async _getEnvironmentVariables(
        resource: Resource,
        purpose: 'RunPythonCode' | 'RunNonPythonCode',
        token?: CancellationToken
    ): Promise<EnvironmentVariables> {
        let customEnvVars = await this.getCustomEnvironmentVariables(resource, purpose, token);
        if (token?.isCancellationRequested) {
            return {};
        }
        if (customEnvVars && purpose === 'RunPythonCode' && this.extensionChecker.isPythonExtensionInstalled) {
            // Python extension API returns the resolved env variables.
            return customEnvVars;
        }
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
        const workspaceFolders = workspace.workspaceFolders || [];
        const defaultWorkspaceFolderUri = workspaceFolders.length === 1 ? workspaceFolders[0].uri : undefined;
        if (!resource) {
            return defaultWorkspaceFolderUri;
        }
        // Possible user opens a file outside the workspace folder, in this case load .env file from workspace folder as the fallback.
        return workspace.getWorkspaceFolder(resource!)?.uri || defaultWorkspaceFolderUri;
    }

    private onEnvironmentFileCreated(workspaceFolderUri?: Uri) {
        this.onEnvironmentFileChanged(workspaceFolderUri);
        sendFileCreationTelemetry();
    }

    private onEnvironmentFileChanged(workspaceFolderUri: Resource) {
        new InMemoryCache<EnvironmentVariables>(
            this.cacheDuration,
            this.getCacheKeyForMergedVars(workspaceFolderUri)
        ).clear();
        new InMemoryCache<EnvironmentVariables>(
            this.cacheDuration,
            this.getCacheKeyForCustomVars(workspaceFolderUri)
        ).clear();

        this.changeEventEmitter.fire(workspaceFolderUri);
    }
    private getCacheKeyForMergedVars(workspaceFolderUri: Resource) {
        return `${getWorkspaceFolderIdentifier(workspaceFolderUri)}:RunNonPythonCode`;
    }
    private getCacheKeyForCustomVars(workspaceFolderUri: Resource) {
        return `${getWorkspaceFolderIdentifier(workspaceFolderUri)}:RunNonPythonCode:CustomVars`;
    }
}
