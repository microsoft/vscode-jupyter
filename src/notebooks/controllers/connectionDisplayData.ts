// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable, inject } from 'inversify';
import { Event, EventEmitter } from 'vscode';
import {
    getDisplayNameOrNameOfKernelConnection,
    getKernelConnectionDisplayPath,
    getKernelRegistrationInfo,
    getRemoteKernelSessionInformation
} from '../../kernels/helpers';
import { IJupyterServerUriStorage } from '../../kernels/jupyter/types';
import { KernelConnectionMetadata, RemoteKernelConnectionMetadata } from '../../kernels/types';
import { IWorkspaceService } from '../../platform/common/application/types';
import { IPlatformService } from '../../platform/common/platform/types';
import { IDisposable, IDisposableRegistry } from '../../platform/common/types';
import { DataScience } from '../../platform/common/utils/localize';
import { noop } from '../../platform/common/utils/misc';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import { EnvironmentType, PythonEnvironment } from '../../platform/pythonEnvironments/info';
import { jupyterServerHandleToString } from '../../kernels/jupyter/jupyterUtils';

export interface IConnectionDisplayData extends IDisposable {
    readonly onDidChange: Event<ConnectionDisplayData>;
    readonly connectionId: string;
    readonly label: string;
    readonly description: string | undefined;
    readonly detail: string;
    readonly category: string;
    readonly serverDisplayName?: string;
}

class ConnectionDisplayData implements IDisposable, IConnectionDisplayData {
    private readonly _onDidChange = new EventEmitter<ConnectionDisplayData>();
    public readonly onDidChange = this._onDidChange.event;

    constructor(
        public readonly connectionId: string,
        public label: string,
        public description: string | undefined,
        public detail: string,
        public category: string,
        public serverDisplayName?: string
    ) {}
    dispose(): void | undefined {
        this._onDidChange.dispose();
    }
    public triggerChange() {
        this._onDidChange.fire(this);
    }
}

@injectable()
export class ConnectionDisplayDataProvider {
    private readonly details = new Map<string, ConnectionDisplayData>();
    constructor(
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(IPlatformService) private readonly platform: IPlatformService,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IInterpreterService) private readonly interpreters: IInterpreterService
    ) {}

    public getDisplayData(connection: KernelConnectionMetadata): IConnectionDisplayData {
        if (!this.details.get(connection.id)) {
            const label = getDisplayNameOrNameOfKernelConnection(connection);
            const description = getKernelConnectionDisplayPath(connection, this.workspace, this.platform);
            const detail =
                connection.kind === 'connectToLiveRemoteKernel' ? getRemoteKernelSessionInformation(connection) : '';
            const category = getKernelConnectionCategorySync(connection);
            const newDetails = new ConnectionDisplayData(connection.id, label, description, detail, category);
            this.disposables.push(newDetails);
            this.details.set(connection.id, newDetails);

            // If the interpreter information changes, then update the display data.
            if (connection.kind === 'startUsingPythonInterpreter' && connection.interpreter.isCondaEnvWithoutPython) {
                const updateInterpreterInfo = (e: PythonEnvironment[]) => {
                    const changedEnv = e.find((env) => env.id === connection.interpreter?.id);
                    const interpreter = this.interpreters.resolvedEnvironments.find((env) => env.id === changedEnv?.id);
                    if (connection.kind === 'startUsingPythonInterpreter' && interpreter) {
                        connection.updateInterpreter(interpreter);
                        const newLabel = getDisplayNameOrNameOfKernelConnection(connection);
                        const newDescription = getKernelConnectionDisplayPath(
                            connection,
                            this.workspace,
                            this.platform
                        );
                        const newCategory = getKernelConnectionCategorySync(connection);
                        let changed = false;
                        if (newLabel !== newDetails.label) {
                            newDetails.label = newLabel;
                            changed = true;
                        }
                        if (newDescription !== newDetails.description) {
                            newDetails.description = newDescription;
                            changed = true;
                        }
                        if (newCategory !== newDetails.category) {
                            newDetails.category = newCategory;
                            changed = true;
                        }
                        if (changed) {
                            newDetails.triggerChange();
                        }
                    }
                };
                this.interpreters.onDidChangeInterpreter(
                    (e) => (e ? updateInterpreterInfo([e]) : undefined),
                    this,
                    this.disposables
                );
                this.interpreters.onDidChangeInterpreters(updateInterpreterInfo, this, this.disposables);
            }
        }
        const details: ConnectionDisplayData = this.details.get(connection.id)!;
        this.details.set(connection.id, details);

        if (connection.kind === 'connectToLiveRemoteKernel' || connection.kind === 'startUsingRemoteKernelSpec') {
            getRemoteServerDisplayName(connection, this.serverUriStorage)
                .then((displayName) => {
                    if (details.serverDisplayName !== displayName) {
                        details.serverDisplayName = displayName;

                        details.triggerChange();
                        return;
                    }
                })
                .catch(noop);
        }

        getKernelConnectionCategory(connection, this.serverUriStorage)
            .then((kind) => {
                if (details.category !== kind) {
                    details.category = kind;
                    details.triggerChange();
                }
            })
            .catch(noop);

        return details;
    }
}

// For Remote connections, check if we have a saved display name for the server.
async function getRemoteServerDisplayName(
    kernelConnection: RemoteKernelConnectionMetadata,
    serverUriStorage: IJupyterServerUriStorage
): Promise<string> {
    const targetConnection = await serverUriStorage.get(kernelConnection.serverHandle);

    // We only show this if we have a display name and the name is not the same as the URI (this prevents showing the long token for user entered URIs).
    if (
        targetConnection &&
        targetConnection.displayName &&
        jupyterServerHandleToString(targetConnection.serverHandle) !== targetConnection.displayName
    ) {
        return targetConnection.displayName;
    }

    return DataScience.kernelDefaultRemoteDisplayName;
}

async function getKernelConnectionCategory(
    kernelConnection: KernelConnectionMetadata,
    serverUriStorage: IJupyterServerUriStorage
): Promise<string> {
    switch (kernelConnection.kind) {
        case 'connectToLiveRemoteKernel':
            const remoteDisplayNameSession = await getRemoteServerDisplayName(kernelConnection, serverUriStorage);
            return DataScience.kernelCategoryForJupyterSession(remoteDisplayNameSession);
        case 'startUsingRemoteKernelSpec':
            const remoteDisplayNameSpec = await getRemoteServerDisplayName(kernelConnection, serverUriStorage);
            return DataScience.kernelCategoryForRemoteJupyterKernel(remoteDisplayNameSpec);
        default:
            return getKernelConnectionCategorySync(kernelConnection);
    }
}
export function getKernelConnectionCategorySync(kernelConnection: KernelConnectionMetadata): string {
    switch (kernelConnection.kind) {
        case 'startUsingLocalKernelSpec':
            return DataScience.kernelCategoryForJupyterKernel;
        case 'startUsingPythonInterpreter': {
            if (
                getKernelRegistrationInfo(kernelConnection.kernelSpec) ===
                'registeredByNewVersionOfExtForCustomKernelSpec'
            ) {
                return DataScience.kernelCategoryForJupyterKernel;
            }
            switch (kernelConnection.interpreter.envType) {
                case EnvironmentType.Conda:
                    return kernelConnection.interpreter.isCondaEnvWithoutPython
                        ? DataScience.kernelCategoryForCondaWithoutPython
                        : DataScience.kernelCategoryForConda;
                case EnvironmentType.Pipenv:
                    return DataScience.kernelCategoryForPipEnv;
                case EnvironmentType.Poetry:
                    return DataScience.kernelCategoryForPoetry;
                case EnvironmentType.Pyenv:
                    return DataScience.kernelCategoryForPyEnv;
                case EnvironmentType.Venv:
                case EnvironmentType.VirtualEnv:
                case EnvironmentType.VirtualEnvWrapper:
                    return DataScience.kernelCategoryForVirtual;
                default:
                    return DataScience.kernelCategoryForGlobal;
            }
        }
        default:
            return '';
    }
}
