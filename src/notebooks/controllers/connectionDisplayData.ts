// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EventEmitter } from 'vscode';
import { getKernelRegistrationInfo } from '../../kernels/helpers';
import { KernelConnectionMetadata } from '../../kernels/types';
import { IDisposable } from '../../platform/common/types';
import { DataScience } from '../../platform/common/utils/localize';
import { EnvironmentType } from '../../platform/pythonEnvironments/info';
import { IConnectionDisplayData } from './types';

export class ConnectionDisplayData implements IDisposable, IConnectionDisplayData {
    private readonly _onDidChange = new EventEmitter<ConnectionDisplayData>();
    public readonly onDidChange = this._onDidChange.event;
    public get description(): string | undefined {
        return this.getDescription?.() || this._description;
    }
    public set description(value: string | undefined) {
        this._description = value;
    }
    constructor(
        public label: string,
        private _description: string | undefined,
        public detail: string,
        public category: string,
        public serverDisplayName?: string,
        private readonly getDescription?: () => string
    ) {}
    dispose(): void | undefined {
        this._onDidChange.dispose();
    }
    public triggerChange() {
        this._onDidChange.fire(this);
    }
}

export function getKernelConnectionCategory(kernelConnection: KernelConnectionMetadata): string {
    switch (kernelConnection.kind) {
        case 'connectToLiveRemoteKernel':
            return DataScience.kernelCategoryForJupyterSession;
        case 'startUsingRemoteKernelSpec':
            return DataScience.kernelCategoryForRemoteJupyterKernel;
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
