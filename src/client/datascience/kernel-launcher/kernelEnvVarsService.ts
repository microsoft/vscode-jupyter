// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import * as path from 'path';
import { traceError, traceInfo } from '../../common/logger';
import { Resource } from '../../common/types';
import { noop } from '../../common/utils/misc';
import { IEnvironmentVariablesProvider, IEnvironmentVariablesService } from '../../common/variables/types';
import { IEnvironmentActivationService } from '../../interpreter/activation/types';
import { IInterpreterService } from '../../interpreter/contracts';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { IJupyterKernelSpec } from '../types';

@injectable()
export class KernelEnvironmentVariablesService {
    constructor(
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(IEnvironmentActivationService) private readonly envActivation: IEnvironmentActivationService,
        @inject(IEnvironmentVariablesService) private readonly envVarsService: IEnvironmentVariablesService,
        @inject(IEnvironmentVariablesProvider) private readonly customEnvVars: IEnvironmentVariablesProvider
    ) {}
    /**
     * If the kernel belongs to a conda environment, then use the env variables of the conda environment and merge that with the env variables of the kernel spec.
     * In the case of some kernels such as java, the kernel spec contains the cli as such `argv = ['java', 'xyz']`.
     * The first item in the kernelspec argv is an kernel executable, and it might not in the current path (e.g. `java`).
     * However, when activating the conda env, the path variables are updated to set path to the location where the java executable is located.
     */
    public async getEnvironmentVariables(
        resource: Resource,
        interpreter: PythonEnvironment | undefined,
        kernelSpec: IJupyterKernelSpec
    ) {
        let kernelEnv = kernelSpec.env && Object.keys(kernelSpec.env).length > 0 ? kernelSpec.env : undefined;

        // If an interpreter was not explicitly passed in, check for an interpreter path in the kernelspec to use
        if (!interpreter) {
            if (!kernelSpec.interpreterPath) {
                traceInfo(
                    `No custom variables for Kernel as interpreter path is not defined for kernel ${kernelSpec.display_name}`
                );
                return kernelEnv;
            }
            interpreter = await this.interpreterService
                .getInterpreterDetails(kernelSpec.interpreterPath)
                .catch((ex) => {
                    traceError('Failed to fetch interpreter information for interpreter that owns a kernel', ex);
                    return undefined;
                });
        }

        let [customEditVars, interpreterEnv] = await Promise.all([
            this.customEnvVars.getCustomEnvironmentVariables(resource).catch(noop),
            interpreter
                ? this.envActivation
                      .getActivatedEnvironmentVariables(resource, interpreter, false)
                      .catch<undefined>((ex) => {
                          traceError('Failed to get env variables for interpreter, hence no variables for Kernel', ex);
                          return undefined;
                      })
                : undefined
        ]);
        if (!interpreterEnv && Object.keys(customEditVars || {}).length === 0) {
            traceInfo('No custom variables nor do we have a conda environment');
            // Ensure the python env folder is always at the top of the PATH, this way all executables from that env are used.
            // This way shell commands such as `!pip`, `!python` end up pointing to the right executables.
            // Also applies to `!java` where java could be an executable in the conda bin directory.
            if (interpreter) {
                const env = kernelEnv || process.env;
                this.envVarsService.prependPath(env, path.dirname(interpreter.path));
                return env;
            }
            return kernelEnv;
        }
        // Merge the env variables with that of the kernel env.
        const hasInterpreterEnv = interpreterEnv != undefined;
        interpreterEnv = interpreterEnv || {};
        const mergedVars = { ...process.env };
        kernelEnv = kernelEnv || {};
        customEditVars = customEditVars || {};
        this.envVarsService.mergeVariables(interpreterEnv, mergedVars); // interpreter vars win over proc.
        this.envVarsService.mergeVariables(kernelEnv, mergedVars); // kernels vars win over interpreter.
        this.envVarsService.mergeVariables(customEditVars, mergedVars); // custom vars win over all.
        // Reinitialize the PATH variables.
        // The values in `PATH` found in the interpreter trumps everything else.
        // If we have more PATHS, they need to be appended to this PATH.
        // Similarly for `PTYHONPATH`
        // Additionally the 'PATH' variable may have different case in each, so account for that.
        let otherEnvPathKey = Object.keys(interpreterEnv).find((k) => k.toLowerCase() == 'path');
        const processPathKey = Object.keys(mergedVars).find((k) => k.toLowerCase() == 'path') || otherEnvPathKey;
        if (otherEnvPathKey && processPathKey) {
            mergedVars[processPathKey] = interpreterEnv[otherEnvPathKey];
        }
        if (interpreterEnv['PYTHONPATH']) {
            mergedVars['PYTHONPATH'] = interpreterEnv['PYTHONPATH'];
        }
        otherEnvPathKey = Object.keys(customEditVars).find((k) => k.toLowerCase() == 'path');
        if (otherEnvPathKey && customEditVars[otherEnvPathKey]) {
            this.envVarsService.appendPath(mergedVars, customEditVars[otherEnvPathKey]!);
        }
        otherEnvPathKey = Object.keys(kernelEnv).find((k) => k.toLowerCase() == 'path');
        if (otherEnvPathKey && kernelEnv[otherEnvPathKey]) {
            this.envVarsService.appendPath(mergedVars, kernelEnv[otherEnvPathKey]!);
        }
        if (customEditVars.PYTHONPATH) {
            this.envVarsService.appendPythonPath(mergedVars, customEditVars.PYTHONPATH);
        }
        if (kernelEnv.PYTHONPATH) {
            this.envVarsService.appendPythonPath(mergedVars, kernelEnv.PYTHONPATH);
        }
        // Ensure the python env folder is always at the top of the PATH, this way all executables from that env are used.
        // This way shell commands such as `!pip`, `!python` end up pointing to the right executables.
        // Also applies to `!java` where java could be an executable in the conda bin directory.
        if (interpreter) {
            this.envVarsService.prependPath(mergedVars, path.dirname(interpreter.path));
        }

        // Ensure global site_packages are not in the path for non global environments
        // The global site_packages will be added to the path later.
        // For more details see here https://github.com/microsoft/vscode-jupyter/issues/8553#issuecomment-997144591
        // https://docs.python.org/3/library/site.html#site.ENABLE_USER_SITE
        if (hasInterpreterEnv) {
            mergedVars.PYTHONNOUSERSITE = 'True';
        }

        return mergedVars;
    }
}
