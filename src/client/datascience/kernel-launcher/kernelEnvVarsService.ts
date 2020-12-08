// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { traceError, traceInfo } from '../../common/logger';
import { IPlatformService } from '../../common/platform/types';
import { Resource } from '../../common/types';
import { noop } from '../../common/utils/misc';
import { IEnvironmentVariablesProvider, IEnvironmentVariablesService } from '../../common/variables/types';
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
        @inject(IPlatformService) private readonly platformService: IPlatformService,
        @inject(IEnvironmentVariablesProvider) private readonly customEndVars: IEnvironmentVariablesProvider
    ) {}
    /**
     * If the kernel belongs to a conda environment, then use the env variables of the conda environment and merge that with the env variables of the kernel spec.
     * In the case of some kernels such as java, the kernel spec contains the cli as such `argv = ['java', 'xyz']`.
     * The first argument is an executable, and it is not in the current path.
     * However, when activating the conda env, the path variables are updated to set path to the location where the java executable is located.
     */
    public async getEnvironmentVariables(resource: Resource, kernelSpec: IJupyterKernelSpec) {
        const customEditVarsPromise = this.customEndVars.getCustomEnvironmentVariables(resource);
        customEditVarsPromise.catch(noop); // If we return early, we don't want failing promise go unhandled.
        let kernelEnv = kernelSpec.env && Object.keys(kernelSpec.env).length > 0 ? kernelSpec.env : undefined;
        if (!kernelSpec.interpreterPath) {
            traceInfo('No custom variables for Kernel as interpreter path is not defined for kernel');
            return kernelEnv;
        }
        const interpreter = await this.interpreterService
            .getInterpreterDetails(kernelSpec.interpreterPath)
            .catch((ex) => {
                traceError('Failed to fetch interpreter information for interpreter that owns a kernel', ex);
                return undefined;
            });

        if (interpreter?.envType !== EnvironmentType.Conda) {
            traceInfo(`No custom variables for Kernel as interpreter is not conda, but is ${interpreter?.envType}`);
            return kernelEnv;
        }
        traceInfo('Fetching interpreter variables of Conda environment to be used as env vars of Kernel');
        const interpreterEnv = await this.envActivation
            .getActivatedEnvironmentVariables(resource, interpreter, false)
            .catch<undefined>((ex) => {
                traceError('Failed to get env variables for interpreter, hence no variables for Kernel', ex);
                return undefined;
            });
        if (!interpreterEnv) {
            traceInfo('No custom variables for Kernel even thought interpreter is conda');
            return kernelEnv;
        }

        let customEditVars = await customEditVarsPromise.catch((ex) =>
            traceError('Failed to get custom env vars for kernel', ex)
        );
        traceInfo('Got custom variables for Kernel owned by a conda interpreter');
        // Merge the env variables with that of the kernel env.
        const mergedVars = { ...process.env };
        kernelEnv = kernelEnv || {};
        customEditVars = customEditVars || {};
        this.envVarsService.mergeVariables(interpreterEnv, mergedVars); // interpreter vars win over proc.
        this.envVarsService.mergeVariables(kernelEnv, mergedVars); // kernels vars win over interpreter.
        this.envVarsService.mergeVariables(customEditVars, mergedVars); // custom vars win over all.
        const pathVariable = this.platformService.pathVariableName;
        if (process.env[pathVariable]) {
            mergedVars[pathVariable] = process.env[pathVariable];
        }
        if (process.env.PYTHONPATH) {
            mergedVars.PYTHONPATH = process.env.PYTHONPATH;
        }
        if (customEditVars[pathVariable]) {
            this.envVarsService.appendPath(mergedVars, customEditVars[pathVariable]!);
        }
        if (kernelEnv[pathVariable]) {
            this.envVarsService.appendPath(mergedVars, kernelEnv[pathVariable]!);
        }
        if (customEditVars.PYTHONPATH) {
            this.envVarsService.appendPythonPath(mergedVars, customEditVars.PYTHONPATH);
        }
        if (kernelEnv.PYTHONPATH) {
            this.envVarsService.appendPythonPath(mergedVars, kernelEnv.PYTHONPATH);
        }
        return mergedVars;
    }
}
