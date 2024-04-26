// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { traceInfo, traceError, traceVerbose } from '../../../platform/logging';
import { getDisplayPath } from '../../../platform/common/platform/fs-paths';
import { IConfigurationService, Resource } from '../../../platform/common/types';
import { noop } from '../../../platform/common/utils/misc';
import {
    IEnvironmentVariablesService,
    ICustomEnvironmentVariablesProvider,
    EnvironmentVariables
} from '../../../platform/common/variables/types';
import { IEnvironmentActivationService } from '../../../platform/interpreter/activation/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { IJupyterKernelSpec } from '../../types';
import { CancellationToken, Uri } from 'vscode';
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
        kernelSpec: IJupyterKernelSpec,
        token?: CancellationToken
    ) {
        let kernelEnv = kernelSpec.env && Object.keys(kernelSpec.env).length > 0 ? kernelSpec.env : undefined;
        const isPythonKernel = (kernelSpec.language || '').toLowerCase() === PYTHON_LANGUAGE;
        // If an interpreter was not explicitly passed in, check for an interpreter path in the kernelspec to use
        if (!interpreter && kernelSpec.interpreterPath) {
            interpreter = await this.interpreterService
                .getInterpreterDetails(Uri.file(kernelSpec.interpreterPath), token)
                .catch((ex) => {
                    traceError('Failed to fetch interpreter information for interpreter that owns a kernel', ex);
                    return undefined;
                });
        }
        if (token?.isCancellationRequested) {
            return;
        }
        let [customEnvVars, interpreterEnv] = await Promise.all([
            this.customEnvVars
                .getCustomEnvironmentVariables(resource, isPythonKernel ? 'RunPythonCode' : 'RunNonPythonCode', token)
                .catch(noop),
            interpreter
                ? this.envActivation
                      .getActivatedEnvironmentVariables(resource, interpreter, token)
                      .catch<undefined>((ex) => {
                          traceError('Failed to get env variables for interpreter, hence no variables for Kernel', ex);
                          return undefined;
                      })
                : undefined
        ]);
        if (token?.isCancellationRequested) {
            return;
        }
        await trackKernelResourceInformation(resource, {
            capturedEnvVars: Object.keys(interpreterEnv || {}).length > 0
        });

        if (!interpreterEnv && Object.keys(customEnvVars || {}).length === 0) {
            traceVerbose('No custom variables nor do we have a conda environment');
        }

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

        // Keep a list of the kernelSpec variables that need to be substituted.
        const kernelSpecVariablesRequiringSubstitution: Record<string, string> = {};
        for (const [key, value] of Object.entries(kernelEnv || {})) {
            if (typeof value === 'string' && substituteEnvVars(key, value, process.env) !== value) {
                kernelSpecVariablesRequiringSubstitution[key] = value;
                delete kernelEnv[key];
            }
        }

        if (isPythonKernel || interpreter) {
            // Merge the env variables with that of the kernel env.
            interpreterEnv = interpreterEnv || customEnvVars;

            Object.assign(mergedVars, interpreterEnv, kernelEnv); // kernels vars win over interpreter.

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
        } else {
            // KISS - No need to have any special handling for PATH for non-python kernels.
            // We can support this, however since this has not been requested, lets not do it.'
            this.envVarsService.mergeVariables(kernelEnv, mergedVars); // kernels vars win over interpreter.
            this.envVarsService.mergeVariables(customEnvVars, mergedVars); // custom vars win over all.
        }

        traceVerbose(
            `Kernel Env Variables for ${kernelSpec.specFile || kernelSpec.name}, PATH value is ${mergedVars.PATH}`
        );

        // env variables in kernelSpecs can contain variables that need to be substituted
        for (const [key, value] of Object.entries(kernelSpecVariablesRequiringSubstitution)) {
            mergedVars[key] = substituteEnvVars(key, value, mergedVars);
        }

        return mergedVars;
    }
}

const SUBST_REGEX = /\${([a-zA-Z]\w*)?([^}\w].*)?}/g;

function substituteEnvVars(key: string, value: string, globalVars: EnvironmentVariables): string {
    if (!value.includes('$')) {
        return value;
    }
    // Substitution here is inspired a little by dotenv-expand:
    //   https://github.com/motdotla/dotenv-expand/blob/master/lib/main.js

    let invalid = false;
    let replacement = value;
    replacement = replacement.replace(SUBST_REGEX, (match, substName, bogus, offset, orig) => {
        if (offset > 0 && orig[offset - 1] === '\\') {
            return match;
        }
        if ((bogus && bogus !== '') || !substName || substName === '') {
            invalid = true;
            return match;
        }
        return globalVars[substName] || '';
    });
    if (!invalid && replacement !== value) {
        traceVerbose(`${key} value in kernelSpec updated from ${value} to ${replacement}`);
        value = replacement;
    }

    return value.replace(/\\\$/g, '$');
}
