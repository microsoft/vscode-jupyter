// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { QuickPickItem, workspace } from 'vscode';
import { Environment } from '../api/pythonApiTypes';
import { BaseProviderBasedQuickPick } from '../common/providerBasedQuickPick';
import { getEnvironmentType, getPythonEnvDisplayName, isCondaEnvironmentWithoutPython } from './helpers';
import { getDisplayPath } from '../common/platform/fs-paths';
import { PlatformService } from '../common/platform/platformService.node';
import { DataScience } from '../common/utils/localize';
import { EnvironmentType } from '../pythonEnvironments/info';

export function pythonEnvironmentQuickPick(item: Environment, quickPick: BaseProviderBasedQuickPick<Environment>) {
    const label = getPythonEnvDisplayName(item);
    const icon =
        item.id === quickPick.recommended?.id
            ? ' $(star-full) '
            : isCondaEnvironmentWithoutPython(item)
            ? '$(warning) '
            : '';
    const quickPickItem: QuickPickItem = { label: `${icon}${label}` };
    quickPickItem.description = getDisplayPath(
        item.executable.uri || item.path,
        workspace.workspaceFolders || [],
        new PlatformService().homeDir
    );
    quickPickItem.tooltip = isCondaEnvironmentWithoutPython(item) ? DataScience.pythonCondaKernelsWithoutPython : '';
    return quickPickItem;
}
export function getPythonEnvironmentCategory(item: Environment): { label: string; sortKey?: string } {
    switch (getEnvironmentType(item)) {
        case EnvironmentType.Conda:
            return isCondaEnvironmentWithoutPython(item)
                ? { label: DataScience.kernelCategoryForCondaWithoutPython, sortKey: 'Z' }
                : { label: DataScience.kernelCategoryForConda };
        case EnvironmentType.Pipenv:
            return { label: DataScience.kernelCategoryForPipEnv };
        case EnvironmentType.Poetry:
            return { label: DataScience.kernelCategoryForPoetry };
        case EnvironmentType.Pyenv:
            return { label: DataScience.kernelCategoryForPyEnv };
        case EnvironmentType.Venv:
        case EnvironmentType.VirtualEnv:
        case EnvironmentType.VirtualEnvWrapper:
            return { label: DataScience.kernelCategoryForVirtual };
        default:
            return { label: DataScience.kernelCategoryForGlobal };
    }
}
