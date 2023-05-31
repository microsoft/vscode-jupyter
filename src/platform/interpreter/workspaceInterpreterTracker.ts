// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri } from 'vscode';
import { IDisposableRegistry, IExtensions, IsWebExtension, Resource } from '../common/types';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { IExtensionSyncActivationService } from '../activation/types';
import { IWorkspaceService } from '../common/application/types';
import { inject, injectable } from 'inversify';
import { IInterpreterService } from './contracts';
import { IPythonExtensionChecker } from '../api/types';
import { areInterpreterPathsSame } from '../pythonEnvironments/info/interpreter';

/**
 * Tracks the interpreters in use for a workspace. Necessary to send kernel telemetry.
 */
@injectable()
export class WorkspaceInterpreterTracker implements IExtensionSyncActivationService {
    private static readonly workspaceInterpreters = new Map<string, undefined | Uri>();
    private trackingInterpreters?: boolean;
    private static getWorkspaceIdentifier: (resource: Resource) => string = () => '';
    constructor(
        @inject(IExtensions) private readonly extensions: IExtensions,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(IPythonExtensionChecker) private readonly pythonExtensionChecker: IPythonExtensionChecker,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(IsWebExtension) private readonly webExtension: boolean
    ) {
        WorkspaceInterpreterTracker.getWorkspaceIdentifier = this.workspaceService.getWorkspaceFolderIdentifier.bind(
            this.workspaceService
        );
    }
    public activate() {
        this.trackActiveInterpreters();
        this.extensions.onDidChange(this.trackActiveInterpreters, this, this.disposables);
    }
    public static isActiveWorkspaceInterpreter(resource: Resource, interpreter?: PythonEnvironment) {
        if (!interpreter) {
            return;
        }
        const key = WorkspaceInterpreterTracker.getWorkspaceIdentifier(resource);
        const activeInterpreterPath = WorkspaceInterpreterTracker.workspaceInterpreters.get(key);
        if (!activeInterpreterPath) {
            return;
        }
        return areInterpreterPathsSame(activeInterpreterPath, interpreter.uri);
    }
    private trackActiveInterpreters() {
        if (this.webExtension) {
            return;
        }
        if (this.trackingInterpreters || !this.pythonExtensionChecker.isPythonExtensionActive) {
            return;
        }
        this.trackingInterpreters = true;
        this.interpreterService.onDidChangeInterpreter(
            async () => {
                const workspaces: Uri[] = Array.isArray(this.workspaceService.workspaceFolders)
                    ? this.workspaceService.workspaceFolders.map((item) => item.uri)
                    : [];
                await Promise.all(
                    workspaces.map(async (item) => {
                        try {
                            const workspaceId = this.workspaceService.getWorkspaceFolderIdentifier(item);
                            const interpreter = await this.interpreterService.getActiveInterpreter(item);
                            WorkspaceInterpreterTracker.workspaceInterpreters.set(workspaceId, interpreter?.uri);
                        } catch (ex) {
                            // Don't care.
                        }
                    })
                );
            },
            this,
            this.disposables
        );
    }
}
