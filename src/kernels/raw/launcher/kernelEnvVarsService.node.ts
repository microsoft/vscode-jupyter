// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import * as path from '../../../platform/vscode-path/path';
import { traceInfo, traceError } from '../../../platform/logging';
import { getDisplayPath } from '../../../platform/common/platform/fs-paths';
import { IConfigurationService, Resource } from '../../../platform/common/types';
import { noop } from '../../../platform/common/utils/misc';
import {
    IEnvironmentVariablesService,
    ICustomEnvironmentVariablesProvider
} from '../../../platform/common/variables/types';
import { IEnvironmentActivationService } from '../../../platform/interpreter/activation/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { IJupyterKernelSpec } from '../../types';
import { Uri } from 'vscode';
import { PYTHON_LANGUAGE } from '../../../platform/common/constants';
import { trackKernelResourceInformation } from '../../telemetry/helper';

/**
 * Class used to fetch environment variables for a kernel.
 */
@injectable()
export class KernelEnvironmentVariablesService {
    constructor(
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(IEnvironmentActivationService) private readonly envActivation: IEnvironmentActivationService,
        @inject(IEnvironmentVariablesService) private readonly envVarsService: IEnvironmentVariablesService,
        @inject(ICustomEnvironmentVariablesProvider)
        private readonly customEnvVars: ICustomEnvironmentVariablesProvider,
        @inject(IConfigurationService) private readonly configService: IConfigurationService
    ) {}
    /**
     * Generates the environment variables for the kernel.
     *
     * Merge env variables from the following 3 sources:
     * 1. kernelspec.json file
     * 2. process.env
     * 3. .env file in workspace folder
     *
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
        const isPythonKernel = (kernelSpec.language || '').toLowerCase() === PYTHON_LANGUAGE;
        // If an interpreter was not explicitly passed in, check for an interpreter path in the kernelspec to use
        if (!interpreter && kernelSpec.interpreterPath) {
            interpreter = await this.interpreterService
                .getInterpreterDetails(Uri.file(kernelSpec.interpreterPath))
                .catch((ex) => {
                    traceError('Failed to fetch interpreter information for interpreter that owns a kernel', ex);
                    return undefined;
                });
        }

        let [customEnvVars, interpreterEnv] = await Promise.all([
            this.customEnvVars
                .getCustomEnvironmentVariables(resource, isPythonKernel ? 'RunPythonCode' : 'RunNonPythonCode')
                .catch(noop),
            interpreter
                ? this.envActivation
                      .getActivatedEnvironmentVariables(resource, interpreter, false)
                      .catch<undefined>((ex) => {
                          traceError('Failed to get env variables for interpreter, hence no variables for Kernel', ex);
                          return undefined;
                      })
                : undefined
        ]);
        await trackKernelResourceInformation(resource, {
            capturedEnvVars: Object.keys(interpreterEnv || {}).length > 0
        });

        if (!interpreterEnv && Object.keys(customEnvVars || {}).length === 0) {
            traceInfo('No custom variables nor do we have a conda environment');
        }
        // Merge the env variables with that of the kernel env.
        interpreterEnv = interpreterEnv || {};
        let mergedVars = { ...process.env };

        // On windows (see https://github.com/microsoft/vscode-jupyter/issues/10940)
        // upper case all of the keys
        if (process.platform === 'win32') {
            mergedVars = {};
            Object.keys(process.env).forEach((k) => {
                mergedVars[k.toUpperCase()] = process.env[k];
            });
        }
        kernelEnv = kernelEnv || {};
        customEnvVars = customEnvVars || {};
        this.envVarsService.mergeVariables(interpreterEnv, mergedVars); // interpreter vars win over proc.
        this.envVarsService.mergeVariables(kernelEnv, mergedVars); // kernels vars win over interpreter.
        this.envVarsService.mergeVariables(customEnvVars, mergedVars); // custom vars win over all.
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
        otherEnvPathKey = Object.keys(customEnvVars).find((k) => k.toLowerCase() == 'path');
        if (otherEnvPathKey && customEnvVars[otherEnvPathKey]) {
            this.envVarsService.appendPath(mergedVars, customEnvVars[otherEnvPathKey]!);
        }
        otherEnvPathKey = Object.keys(kernelEnv).find((k) => k.toLowerCase() == 'path');
        if (otherEnvPathKey && kernelEnv[otherEnvPathKey]) {
            this.envVarsService.appendPath(mergedVars, kernelEnv[otherEnvPathKey]!);
        }
        if (customEnvVars.PYTHONPATH) {
            this.envVarsService.appendPythonPath(mergedVars, customEnvVars.PYTHONPATH);
        }
        if (kernelEnv.PYTHONPATH) {
            this.envVarsService.appendPythonPath(mergedVars, kernelEnv.PYTHONPATH);
        }
        // Ensure the python env folder is always at the top of the PATH, this way all executables from that env are used.
        // This way shell commands such as `!pip`, `!python` end up pointing to the right executables.
        // Also applies to `!java` where java could be an executable in the conda bin directory.
        if (interpreter) {
            this.envVarsService.prependPath(mergedVars, path.dirname(interpreter.uri.fsPath));
        }

        // If user asks us to, set PYTHONNOUSERSITE
        // For more details see here https://github.com/microsoft/vscode-jupyter/issues/8553#issuecomment-997144591
        // https://docs.python.org/3/library/site.html#site.ENABLE_USER_SITE
        if (this.configService.getSettings(undefined).excludeUserSitePackages) {
            traceInfo(`Adding env Variable PYTHONNOUSERSITE to ${getDisplayPath(interpreter?.uri)}`);
            mergedVars.PYTHONNOUSERSITE = 'True';
        }
        if (isPythonKernel) {
            mergedVars.PYDEVD_IPYTHON_COMPATIBLE_DEBUGGING = '1';
        }
        return mergedVars;
    }
}
