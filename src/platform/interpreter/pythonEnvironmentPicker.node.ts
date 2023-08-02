// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken } from 'vscode';
import { Environment } from '../api/pythonApiTypes';
import { BaseProviderBasedQuickPick } from '../common/providerBasedQuickPick';
import { ServiceContainer } from '../ioc/container';
import { PythonEnvironmentQuickPickItemProvider } from './pythonEnvironmentQuickPickProvider.node';

export class PythonEnvironmentPicker extends BaseProviderBasedQuickPick<Environment> {
    constructor(options: { token: CancellationToken; supportsBack: boolean }) {
        super({
            provider: ServiceContainer.instance.get<PythonEnvironmentQuickPickItemProvider>(
                PythonEnvironmentQuickPickItemProvider
            ),
            supportsBack: options.supportsBack,
            token: options.token
        });
    }
}
