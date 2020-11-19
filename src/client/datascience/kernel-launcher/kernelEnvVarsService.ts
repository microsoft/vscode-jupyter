// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { traceError } from '../../common/logger';
import { IPlatformService } from '../../common/platform/types';
import { Resource } from '../../common/types';
import { IEnvironmentVariablesService } from '../../common/variables/types';
import { IEnvironmentActivationService } from '../../interpreter/activation/types';
import { IInterpreterService } from '../../interpreter/contracts';
import { EnvironmentType } from '../../pythonEnvironments/info';
import { IJupyterKernelSpec } from '../types';

@injectable()
export class KernelEnvironmentVariablesService {
    constructor(
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(IEnvironmentActivationService) private readonly envActivation: IEnvironmentActivationService,
        @inject(IEnvironmentVariablesService) private readonly envVarsService: IEnvironmentVariablesService,
        @inject(IPlatformService) private readonly platformService: IPlatformService
    ) {}
    /**
     * If the kernel belongs to a conda environment, then use the env variables of the conda environment and merge that with the env variables of the kernel spec.
     * In the case of some kernels such as java, the kernel spec contains the cli as such `argv = ['java', 'xyz']`.
     * The first argument is an executable, and it is not in the current path.
     * However, when activating the conda env, the path variables are updated to set path to the location where the java executable is located.
     */
    public async getEnvironmentVariables(resource: Resource, kernelSpec: IJupyterKernelSpec) {
        let kernelEnv = kernelSpec.env && Object.keys(kernelSpec.env).length > 0 ? kernelSpec.env : undefined;
        if (!kernelSpec.interpreterPath) {
            return kernelEnv;
        }
        const interpreter = await this.interpreterService
            .getInterpreterDetails(kernelSpec.interpreterPath)
            .catch((ex) => {
                traceError('Failed to fetch interpreter information for interpreter that owns a kernel', ex);
                return undefined;
            });

        if (interpreter?.envType !== EnvironmentType.Conda) {
            return kernelEnv;
        }
        const interpreterEnv = await this.envActivation.getActivatedEnvironmentVariables(resource, interpreter, true);
        if (!interpreterEnv) {
            return kernelEnv;
        }

        // Merge the env variables with that of the kernel env.
        const mergedVars = { ...process.env };
        kernelEnv = kernelEnv || {};
        this.envVarsService.mergeVariables(interpreterEnv, mergedVars);
        this.envVarsService.mergeVariables(kernelEnv, mergedVars);
        if (kernelEnv[this.platformService.pathVariableName]) {
            this.envVarsService.appendPath(mergedVars, kernelEnv[this.platformService.pathVariableName]!);
        }
        if (process.env[this.platformService.pathVariableName]) {
            this.envVarsService.appendPath(mergedVars, process.env[this.platformService.pathVariableName]!);
        }
        if (kernelEnv.PYTHONPATH) {
            this.envVarsService.appendPythonPath(mergedVars, kernelEnv.PYTHONPATH);
        }
        if (process.env.PYTHONPATH) {
            this.envVarsService.appendPythonPath(mergedVars, process.env.PYTHONPATH);
        }
        return mergedVars;
    }
}
