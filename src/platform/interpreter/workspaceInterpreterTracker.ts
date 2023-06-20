// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Resource } from '../common/types';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { IExtensionSyncActivationService } from '../activation/types';
import { inject, injectable, optional } from 'inversify';
import { IWorkspaceInterpreterTracker } from './types';

/**
 * Tracks the interpreters in use for a workspace. Necessary to send kernel telemetry.
 * Only applies to desktop.
 */
@injectable()
export class WorkspaceInterpreterTracker implements IExtensionSyncActivationService {
    public static isActiveWorkspaceInterpreter: (resource: Resource, interpreter?: PythonEnvironment) => boolean = () =>
        false;
    constructor(
        @inject(IWorkspaceInterpreterTracker)
        @optional()
        private readonly workspaceInterpreterTracker: IWorkspaceInterpreterTracker | undefined
    ) {
        WorkspaceInterpreterTracker.isActiveWorkspaceInterpreter = this.isActiveWorkspaceInterpreterImpl.bind(this);
    }
    public activate() {
        this.workspaceInterpreterTracker?.activate();
    }
    public isActiveWorkspaceInterpreterImpl(resource: Resource, interpreter?: PythonEnvironment) {
        return this.workspaceInterpreterTracker?.isActiveWorkspaceInterpreter(resource, interpreter) ?? false;
    }
}
