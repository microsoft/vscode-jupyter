// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable, inject } from 'inversify';
import { EventEmitter } from 'vscode';
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
import { IDisposableRegistry, ReadWrite } from '../../platform/common/types';
import { DataScience } from '../../platform/common/utils/localize';
import { noop } from '../../platform/common/utils/misc';
import { EnvironmentType } from '../../platform/pythonEnvironments/info';

export type ConnectionDisplayData = {
    readonly connectionId: string;
    readonly label: string;
    readonly description: string | undefined;
    readonly detail: string;
    readonly category: string;
};

@injectable()
export class ConnectionDisplayDataProvider {
    private readonly _onDidChange = new EventEmitter<ConnectionDisplayData>();
    public readonly onDidChange = this._onDidChange.event;
    private readonly details = new Map<string, ConnectionDisplayData>();
    constructor(
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(IPlatformService) private readonly platform: IPlatformService,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry
    ) {
        disposables.push(this._onDidChange);
    }

    public getDisplayData(connection: KernelConnectionMetadata): ConnectionDisplayData {
        const label = getDisplayNameOrNameOfKernelConnection(connection);
        const description = getKernelConnectionDisplayPath(connection, this.workspace, this.platform);
        const detail =
            connection.kind === 'connectToLiveRemoteKernel' ? getRemoteKernelSessionInformation(connection) : '';
        const category = getKernelConnectionCategorySync(connection);

        const details: ReadWrite<ConnectionDisplayData> = this.details.get(connection.id) || {
            connectionId: connection.id,
            label,
            description,
            detail,
            category: category
        };
        details.label = label;
        details.description = description;
        details.detail = detail;
        details.category = category || details.category;
        this.details.set(connection.id, details);

        getKernelConnectionCategory(connection, this.serverUriStorage)
            .then((kind) => {
                if (details.category !== kind) {
                    details.category = kind;
                    this._onDidChange.fire(details);
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
    const savedUriList = await serverUriStorage.getSavedUriList();
    const targetConnection = savedUriList.find((uriEntry) => uriEntry.serverId === kernelConnection.serverId);

    // We only show this if we have a display name and the name is not the same as the URI (this prevents showing the long token for user entered URIs).
    if (targetConnection && targetConnection.displayName && targetConnection.uri !== targetConnection.displayName) {
        return targetConnection.displayName;
    }

    return DataScience.kernelDefaultRemoteDisplayName();
}

async function getKernelConnectionCategory(
    kernelConnection: KernelConnectionMetadata,
    serverUriStorage: IJupyterServerUriStorage
): Promise<string> {
    switch (kernelConnection.kind) {
        case 'connectToLiveRemoteKernel':
            const remoteDisplayNameSession = await getRemoteServerDisplayName(kernelConnection, serverUriStorage);
            return DataScience.kernelCategoryForJupyterSession().format(remoteDisplayNameSession);
        case 'startUsingRemoteKernelSpec':
            const remoteDisplayNameSpec = await getRemoteServerDisplayName(kernelConnection, serverUriStorage);
            return DataScience.kernelCategoryForRemoteJupyterKernel().format(remoteDisplayNameSpec);
        default:
            return getKernelConnectionCategorySync(kernelConnection);
    }
}
export function getKernelConnectionCategorySync(kernelConnection: KernelConnectionMetadata): string {
    switch (kernelConnection.kind) {
        case 'startUsingLocalKernelSpec':
            return DataScience.kernelCategoryForJupyterKernel();
        case 'startUsingPythonInterpreter': {
            if (
                getKernelRegistrationInfo(kernelConnection.kernelSpec) ===
                'registeredByNewVersionOfExtForCustomKernelSpec'
            ) {
                return DataScience.kernelCategoryForJupyterKernel();
            }
            switch (kernelConnection.interpreter.envType) {
                case EnvironmentType.Conda:
                    return DataScience.kernelCategoryForConda();
                case EnvironmentType.Pipenv:
                    return DataScience.kernelCategoryForPipEnv();
                case EnvironmentType.Poetry:
                    return DataScience.kernelCategoryForPoetry();
                case EnvironmentType.Pyenv:
                    return DataScience.kernelCategoryForPyEnv();
                case EnvironmentType.Venv:
                case EnvironmentType.VirtualEnv:
                case EnvironmentType.VirtualEnvWrapper:
                    return DataScience.kernelCategoryForVirtual();
                default:
                    return DataScience.kernelCategoryForGlobal();
            }
        }
        default:
            return '';
    }
}
