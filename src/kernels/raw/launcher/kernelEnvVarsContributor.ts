// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { CancellationToken, Disposable, Uri } from 'vscode';
import { KernelEnvironmentVariablesProvider } from '../../../api';

export const IKernelEnvVarsContributorRegistry = Symbol('IKernelEnvVarsContributorRegistry');

export interface IKernelEnvVarsContributorRegistry {
    register(provider: KernelEnvironmentVariablesProvider): Disposable;
    getContributions(resource: Uri | undefined, token?: CancellationToken): Promise<Record<string, string>>;
}

@injectable()
export class KernelEnvVarsContributorRegistry implements IKernelEnvVarsContributorRegistry {
    private readonly providers = new Set<KernelEnvironmentVariablesProvider>();

    public register(provider: KernelEnvironmentVariablesProvider): Disposable {
        this.providers.add(provider);
        return { dispose: () => this.providers.delete(provider) };
    }

    public async getContributions(
        resource: Uri | undefined,
        token?: CancellationToken
    ): Promise<Record<string, string>> {
        const merged: Record<string, string> = {};
        const promises = [...this.providers].map(async (provider) => {
            const vars = await Promise.resolve(provider.provideEnvironmentVariables(resource, token));
            if (vars && !token?.isCancellationRequested) {
                Object.assign(merged, vars);
            }
        });
        await Promise.all(promises);
        return merged;
    }
}
