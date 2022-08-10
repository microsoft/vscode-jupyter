// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { inject, injectable } from 'inversify';
import { IExtensionSingleActivationService } from '../../platform/activation/types';
import { IPythonExtensionChecker } from '../../platform/api/types';
import { CondaService } from '../../platform/common/process/condaService.node';
import { IDisposableRegistry } from '../../platform/common/types';
import { waitForCondition } from '../../platform/common/utils/async';
import { debounceAsync } from '../../platform/common/utils/decorators';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import { EnvironmentType } from '../../platform/pythonEnvironments/info';
import { IControllerLoader } from './types';

/**
 * Listens to the conda service to check for environment updates. If an environment update occurs, it will
 * cause a refresh of the controllers.
 */
@injectable()
export class CondaControllerRefresher implements IExtensionSingleActivationService {
    constructor(
        @inject(IControllerLoader) private readonly controllerLoader: IControllerLoader,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,

        @inject(IInterpreterService) private readonly interpreters: IInterpreterService,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(CondaService) private readonly condaService: CondaService
    ) {}

    public async activate(): Promise<void> {
        this.condaService.onCondaEnvironmentsChanged(this.onDidChangeCondaEnvironments, this, this.disposables);
    }

    @debounceAsync(1_000)
    private async onDidChangeCondaEnvironments() {
        if (!this.extensionChecker.isPythonExtensionInstalled) {
            return;
        }
        // A new conda environment was added or removed, hence refresh the kernels.
        // Wait for the new env to be discovered before refreshing the kernels.
        const previousCondaEnvCount = (await this.interpreters.getInterpreters()).filter(
            (item) => item.envType === EnvironmentType.Conda
        ).length;

        await this.interpreters.refreshInterpreters();
        // Possible discovering interpreters is very quick and we've already discovered it, hence refresh kernels immediately.
        await this.controllerLoader.loadControllers(true);

        // Possible discovering interpreters is slow, hence try for around 10s.
        // I.e. just because we know a conda env was created doesn't necessarily mean its immediately discoverable and usable.
        // Possible it takes some time.
        // Wait for around 5s between each try, we know Python extension can be slow to discover interpreters.
        await waitForCondition(
            async () => {
                const condaEnvCount = (await this.interpreters.getInterpreters()).filter(
                    (item) => item.envType === EnvironmentType.Conda
                ).length;
                if (condaEnvCount > previousCondaEnvCount) {
                    return true;
                }
                await this.interpreters.refreshInterpreters();
                return false;
            },
            15_000,
            5000
        );

        await this.controllerLoader.loadControllers(true);
    }
}
