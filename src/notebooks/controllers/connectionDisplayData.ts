// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EventEmitter } from 'vscode';
import { getKernelRegistrationInfo } from '../../kernels/helpers';
import { IJupyterUriProviderRegistration } from '../../kernels/jupyter/types';
import { KernelConnectionMetadata } from '../../kernels/types';
import { IDisposable } from '../../platform/common/types';
import { DataScience } from '../../platform/common/utils/localize';
import { EnvironmentType } from '../../platform/pythonEnvironments/info';
import { IConnectionDisplayData } from './types';
import { getJupyterDisplayName } from '../../kernels/jupyter/connection/jupyterUriProviderRegistration';

export class ConnectionDisplayData implements IDisposable, IConnectionDisplayData {
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

export async function getKernelConnectionCategory(
    kernelConnection: KernelConnectionMetadata,
    jupyterUriProviderRegistration: IJupyterUriProviderRegistration
): Promise<string> {
    switch (kernelConnection.kind) {
        case 'connectToLiveRemoteKernel':
            const remoteDisplayNameSession = await getJupyterDisplayName(
                kernelConnection.serverProviderHandle,
                jupyterUriProviderRegistration,
                DataScience.kernelDefaultRemoteDisplayName
            );
            return DataScience.kernelCategoryForJupyterSession(remoteDisplayNameSession);
        case 'startUsingRemoteKernelSpec':
            const remoteDisplayNameSpec = await getJupyterDisplayName(
                kernelConnection.serverProviderHandle,
                jupyterUriProviderRegistration,
                DataScience.kernelDefaultRemoteDisplayName
            );
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
