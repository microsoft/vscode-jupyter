// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Uri } from 'vscode';
import { IDisposableRegistry, Resource } from '../../common/types';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { IExtensionSyncActivationService } from '../../activation/types';
import { IWorkspaceService } from '../../common/application/types';
import { inject, injectable } from 'inversify';
import { IInterpreterService } from '../../interpreter/contracts';
import { IPythonExtensionChecker } from '../../api/types';

@injectable()
export class WorkspaceInterpreterTracker implements IExtensionSyncActivationService {
    private static readonly workspaceInterpreters = new Map<string, undefined | string>();
    private static getWorkspaceIdentifier: (resource: Resource) => string = () => '';
    constructor(
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(IPythonExtensionChecker) private readonly pythonExtensionChecker: IPythonExtensionChecker,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService
    ) {
        WorkspaceInterpreterTracker.getWorkspaceIdentifier = this.workspaceService.getWorkspaceFolderIdentifier.bind(
            this.workspaceService
        );
    }
    public activate() {
        this.trackActiveInterpreters();
    }
    public static isActiveWorkspaceInterpreter(resource: Resource, interpreter?: PythonEnvironment) {
        if (!interpreter) {
            return false;
        }
        const key = WorkspaceInterpreterTracker.getWorkspaceIdentifier(resource);
        const activeInterpreterPath = WorkspaceInterpreterTracker.workspaceInterpreters.get(key);
        if (!activeInterpreterPath) {
            return false;
        }
        return activeInterpreterPath === interpreter.path;
    }
    private trackActiveInterpreters() {
        if (!this.pythonExtensionChecker.isPythonExtensionInstalled) {
            return;
        }
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
                            WorkspaceInterpreterTracker.workspaceInterpreters.set(workspaceId, interpreter?.path);
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
