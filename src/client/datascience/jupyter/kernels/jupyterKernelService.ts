// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import type { Kernel } from '@jupyterlab/services';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import * as uuid from 'uuid/v4';
import { CancellationToken, CancellationTokenSource } from 'vscode';
import { Cancellation, wrapCancellationTokens } from '../../../common/cancellation';
import { PYTHON_WARNINGS } from '../../../common/constants';
import '../../../common/extensions';
import { traceDecorators, traceError, traceInfo, traceWarning } from '../../../common/logger';
import { IFileSystem } from '../../../common/platform/types';

import { IPythonExecutionFactory } from '../../../common/process/types';
import { ReadWrite, Resource } from '../../../common/types';
import { sleep } from '../../../common/utils/async';
import { noop } from '../../../common/utils/misc';
import { IEnvironmentActivationService } from '../../../interpreter/activation/types';
import { PythonEnvironment } from '../../../pythonEnvironments/info';
import { captureTelemetry, sendTelemetryEvent } from '../../../telemetry';
import { getRealPath } from '../../common';
import { Telemetry } from '../../constants';
import { ILocalKernelFinder } from '../../kernel-launcher/types';
import { reportAction } from '../../progress/decorator';
import { ReportableAction } from '../../progress/types';
import {
    IJupyterKernelSpec,
    IKernelDependencyService
} from '../../types';
import { cleanEnvironment } from './helpers';
import { JupyterKernelSpec } from './jupyterKernelSpec';
import { KernelConnectionMetadata } from './types';

// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const NamedRegexp = require('named-js-regexp') as typeof import('named-js-regexp');

/**
 * Responsible for registering and updating kernels
 *
 * @export
 * @class JupyterKernelService
 */
@injectable()
export class JupyterKernelService {
    constructor(
        @inject(IPythonExecutionFactory) private readonly execFactory: IPythonExecutionFactory,
        @inject(IKernelDependencyService) private readonly kernelDependencyService: IKernelDependencyService,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IEnvironmentActivationService) private readonly activationHelper: IEnvironmentActivationService,
        @inject(ILocalKernelFinder) private readonly kernelFinder: ILocalKernelFinder
    ) {}

    /**
     * Makes sure that the kernel pointed to is a valid jupyter kernel (it registers it) and
     * that is up to date relative to the interpreter that it might contain
     * @param resource
     * @param kernel
     */
    public async ensureKernelIsUsable(
        resource: Resource,
        kernel: KernelConnectionMetadata,
        cancelToken?: CancellationToken,
        disableUI?: boolean
    ): Promise<void> {
        // If we wish to wait for installation to complete, we must provide a cancel token.
        const tokenSource = new CancellationTokenSource();
        const token = wrapCancellationTokens(cancelToken, tokenSource.token);

        // If we have an interpreter, make sure it has the correct dependencies installed
        if (kernel.kind !== 'connectToLiveKernel' && kernel.interpreter) {
            await this.kernelDependencyService.installMissingDependencies(kernel.interpreter, token, disableUI);
        }

        // If the spec file doesn't exist or is not defined, we need to register this kernel
        if (kernel.kind !== 'connectToLiveKernel' && kernel.kernelSpec && kernel.interpreter) {
            if (!kernel.kernelSpec.specFile || !(await this.fs.localFileExists(kernel.kernelSpec.specFile))) {
                await this.registerKernel(resource, kernel.interpreter, kernel.kernelSpec.name, token);
            }
            // Special case. If the original spec file came from an interpreter, we may need to register a kernel
            else if (!kernel.interpreter && kernel.kernelSpec.specFile) {
                // See if the specfile we started with (which might be the one registered in the interpreter)
                // doesn't match the name of the spec file
                if (!kernel.kernelSpec.specFile.includes(kernel.kernelSpec.name)) {
                    // This means the specfile for the kernelspec will not be found by jupyter. We need to
                    // register it
                    await this.registerKernel(resource, kernel.interpreter, kernel.kernelSpec.name, token);
                }

            }
        }

        // Update the kernel environment to use the interpreter's latest
        if (kernel.kind !== 'connectToLiveKernel' && kernel.kernelSpec && kernel.interpreter) {
            await this.updateKernelEnvironment(kernel.interpreter, kernel.kernelSpec, token);
        }
    }

    /**
     * Registers an interpreter as a kernel.
     * The assumption is that `ipykernel` has been installed in the interpreter.
     * Kernel created will have following characteristics:
     * - display_name = Display name of the interpreter.
     * - metadata.interperter = Interpreter information (useful in finding a kernel that matches a given interpreter)
     * - env = Will have environment variables of the activated environment.
     *
     * @param {PythonEnvironment} interpreter
     * @param {boolean} [disableUI]
     * @param {CancellationToken} [cancelToken]
     * @returns {Promise<IJupyterKernelSpec>}
     * @memberof KernelService
     */
    // eslint-disable-next-line
    // eslint-disable-next-line complexity
    @captureTelemetry(Telemetry.RegisterInterpreterAsKernel, undefined, true)
    @traceDecorators.error('Failed to register an interpreter as a kernel')
    @reportAction(ReportableAction.KernelsRegisterKernel)
    // eslint-disable-next-line
    private async registerKernel(
        resource: Resource,
        interpreter: PythonEnvironment,
        name: string,
        cancelToken?: CancellationToken
    ): Promise<IJupyterKernelSpec | undefined> {
        if (!interpreter.displayName) {
            throw new Error('Interpreter does not have a display name');
        }

        const execServicePromise = this.execFactory.createActivatedEnvironment({
            interpreter,
            allowEnvironmentFetchExceptions: true,
            bypassCondaExecution: true
        });
        // Swallow errors if we get out of here and not resolve this.
        execServicePromise.ignoreErrors();
        const execService = await execServicePromise;
        const output = await execService.execModule(
            'ipykernel',
            ['install', '--user', '--name', name, '--display-name', interpreter.displayName],
            {
                throwOnStdErr: false,
                encoding: 'utf8',
                token: cancelToken
            }
        );
        if (Cancellation.isCanceled(cancelToken)) {
            return;
        }

        const findKernelSpec = async () => {
            const metadata = await this.kernelFinder.findKernel(resource, interpreter, cancelToken);
            if (metadata) {
                return metadata.kernelSpec;
            }
        };

        let kernel = await findKernelSpec();
        // Wait for at least 5s. We know launching a python (conda env) process on windows can sometimes take around 4s.
        for (let counter = 0; counter < 10; counter += 1) {
            if (Cancellation.isCanceled(cancelToken)) {
                return;
            }
            if (kernel) {
                break;
            }
            traceWarning('Waiting for 500ms for registered kernel to get detected');
            // Wait for jupyter server to get updated with the new kernel information.
            await sleep(500);

            // Clear our finder cache
            this.kernelFinder.clearCache(resource);

            // Look again
            kernel = await findKernelSpec();
        }
        if (!kernel) {
            // Possible user doesn't have kernelspec installed.
            kernel = await this.getKernelSpecFromStdOut(output.stdout).catch(
                (ex) => {
                    traceError('Failed to get kernelspec from stdout', ex);
                    return undefined;
                }
            );
        }
        if (!kernel) {
            const error = `Kernel not created with the name ${name}, display_name ${interpreter.displayName}. Output is ${output.stdout}`;
            throw new Error(error);
        }
        if (!(kernel instanceof JupyterKernelSpec)) {
            const error = `Kernel not registered locally, created with the name ${name}, display_name ${interpreter.displayName}. Output is ${output.stdout}`;
            throw new Error(error);
        }
        if (!kernel.specFile) {
            const error = `kernel.json not created with the name ${name}, display_name ${interpreter.displayName}. Output is ${output.stdout}`;
            throw new Error(error);
        }

        sendTelemetryEvent(Telemetry.RegisterAndUseInterpreterAsKernel);
        traceInfo(
            `Kernel successfully registered for ${interpreter.path} with the name=${name} and spec can be found here ${kernel.specFile}`
        );
        return kernel;
    }
    private async updateKernelEnvironment(
        interpreter: PythonEnvironment | undefined,
        kernel: IJupyterKernelSpec,
        cancelToken?: CancellationToken,
        forceWrite?: boolean
    ) {
        const specedKernel = kernel as JupyterKernelSpec;
        if (specedKernel.specFile) {
            let specModel: ReadWrite<Kernel.ISpecModel> = JSON.parse(
                await this.fs.readLocalFile(specedKernel.specFile)
            );
            let shouldUpdate = false;

            // Make sure the specmodel has an interpreter or already in the metadata or we
            // may overwrite a kernel created by the user
            if (interpreter && (specModel.metadata?.interpreter || forceWrite)) {
                // Ensure we use a fully qualified path to the python interpreter in `argv`.
                if (specModel.argv[0].toLowerCase() === 'conda') {
                    // If conda is the first word, its possible its a conda activation command.
                    traceInfo(`Spec argv[0], not updated as it is using conda.`);
                } else {
                    traceInfo(`Spec argv[0] updated from '${specModel.argv[0]}' to '${interpreter.path}'`);
                    specModel.argv[0] = interpreter.path;
                }

                // Get the activated environment variables (as a work around for `conda run` and similar).
                // This ensures the code runs within the context of an activated environment.
                specModel.env = await this.activationHelper
                    .getActivatedEnvironmentVariables(undefined, interpreter, true)
                    .catch(noop)
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    .then((env) => (env || {}) as any);
                if (Cancellation.isCanceled(cancelToken)) {
                    return;
                }

                // Special case, modify the PYTHONWARNINGS env to the global value.
                // otherwise it's forced to 'ignore' because activated variables are cached.
                if (specModel.env && process.env[PYTHON_WARNINGS]) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    specModel.env[PYTHON_WARNINGS] = process.env[PYTHON_WARNINGS] as any;
                } else if (specModel.env && specModel.env[PYTHON_WARNINGS]) {
                    delete specModel.env[PYTHON_WARNINGS];
                }
                // Ensure we update the metadata to include interpreter stuff as well (we'll use this to search kernels that match an interpreter).
                // We'll need information such as interpreter type, display name, path, etc...
                // Its just a JSON file, and the information is small, hence might as well store everything.
                specModel.metadata = specModel.metadata || {};
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                specModel.metadata.interpreter = interpreter as any;

                // Indicate we need to write
                shouldUpdate = true;
            }

            // Scrub the environment of the specmodel to make sure it has allowed values (they all must be strings)
            // See this issue here: https://github.com/microsoft/vscode-python/issues/11749
            if (specModel.env) {
                specModel = cleanEnvironment(specModel);
                shouldUpdate = true;
            }

            // Update the kernel.json with our new stuff.
            if (shouldUpdate) {
                await this.fs.writeLocalFile(specedKernel.specFile, JSON.stringify(specModel, undefined, 2));
            }

            // Always update the metadata for the original kernel.
            specedKernel.metadata = specModel.metadata;
        }
    }

    /**
     * Will scrape kernelspec info from the output when a new kernel is created.
     *
     * @private
     * @param {string} output
     * @returns {JupyterKernelSpec}
     * @memberof KernelService
     */
    @traceDecorators.error('Failed to parse kernel creation stdout')
    private async getKernelSpecFromStdOut(output: string): Promise<JupyterKernelSpec | undefined> {
        if (!output) {
            return;
        }

        // Output should be of the form
        // `Installed kernel <kernelname> in <path>`
        const regEx = NamedRegexp('Installed\\skernelspec\\s(?<name>\\w*)\\sin\\s(?<path>.*)', 'g');
        const match = regEx.exec(output);
        if (!match || !match.groups()) {
            return;
        }

        type RegExGroup = { name: string; path: string };
        const groups = match.groups() as RegExGroup | undefined;

        if (!groups || !groups.name || !groups.path) {
            traceError('Kernel Output not parsed', output);
            throw new Error('Unable to parse output to get the kernel info');
        }

        const specFile = await getRealPath(
            path.join(groups.path, 'kernel.json')
        );
        if (!specFile) {
            throw new Error('KernelSpec file not found');
        }

        const kernelModel = JSON.parse(await this.fs.readLocalFile(specFile));
        kernelModel.name = groups.name;
        return new JupyterKernelSpec(kernelModel as Kernel.ISpecModel, specFile);
    }
}
