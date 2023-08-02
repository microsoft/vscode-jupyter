// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken } from 'vscode';
import { Environment } from '../api/pythonApiTypes';
import { BaseProviderBasedQuickPick } from '../common/providerBasedQuickPick';
import { ServiceContainer } from '../ioc/container';
import { PythonEnvironmentQuickPickItemProvider } from './pythonEnvironmentQuickPickProvider.node';

export class PythonEnvironmentPicker extends BaseProviderBasedQuickPick<Environment> {
    constructor(options: {
        token: CancellationToken;
        supportsBack: boolean;
        placeholder?: string;
        isSelected?: (item: Environment) => boolean;
        isRecommended?: (item: Environment) => boolean;
    }) {
        super({
            provider: ServiceContainer.instance.get<PythonEnvironmentQuickPickItemProvider>(
                PythonEnvironmentQuickPickItemProvider
            ),
            supportsBack: options.supportsBack,
            token: options.token,
            placeholder: options.placeholder,
            isSelected: (item) => (options.isSelected ? options.isSelected(item) : false),
            isRecommended: (item) => (options.isRecommended ? options.isRecommended(item) : false),
            toQuickPick: (item) =>
                PythonEnvironmentQuickPickItemProvider.toQuickPick(
                    item,
                    options.isRecommended ? options.isRecommended(item) : false
                ),
            getCategory: (item) => PythonEnvironmentQuickPickItemProvider.getCategory(item)
        });
    }
}
