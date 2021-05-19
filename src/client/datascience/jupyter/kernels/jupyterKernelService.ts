// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import type { Kernel } from '@jupyterlab/services';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import { CancellationToken, CancellationTokenSource } from 'vscode';
import { Cancellation, wrapCancellationTokens } from '../../../common/cancellation';
import '../../../common/extensions';
import { traceDecorators, traceInfo } from '../../../common/logger';
import { IFileSystem } from '../../../common/platform/types';

import { ReadWrite, Resource } from '../../../common/types';
import { noop } from '../../../common/utils/misc';
import { IEnvironmentActivationService } from '../../../interpreter/activation/types';
import { PythonEnvironment } from '../../../pythonEnvironments/info';
import { captureTelemetry, sendTelemetryEvent } from '../../../telemetry';
import { Telemetry } from '../../constants';
import { ILocalKernelFinder } from '../../kernel-launcher/types';
import { reportAction } from '../../progress/decorator';
import { ReportableAction } from '../../progress/types';
import { IJupyterKernelSpec, IKernelDependencyService } from '../../types';
import { cleanEnvironment } from './helpers';
import { JupyterKernelSpec } from './jupyterKernelSpec';
import { KernelConnectionMetadata, LocalKernelConnectionMetadata } from './types';

/**
 * Responsible for registering and updating kernels
 *
 * @export
 * @class JupyterKernelService
 */
@injectable()
export class JupyterKernelService {
    constructor(
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
    @traceDecorators.verbose('Check if a kernel is usable')
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
            await this.kernelDependencyService.installMissingDependencies(
                resource,
                kernel.interpreter,
                token,
                disableUI
            );
        }

        // If the spec file doesn't exist or is not defined, we need to register this kernel
        if (kernel.kind !== 'connectToLiveKernel' && kernel.kernelSpec && kernel.interpreter) {
            if (!kernel.kernelSpec.specFile || !(await this.fs.localFileExists(kernel.kernelSpec.specFile))) {
                await this.registerKernel(kernel, token);
            }
            // Special case. If the original spec file came from an interpreter, we may need to register a kernel
            else if (kernel.interpreter && kernel.kernelSpec.specFile) {
                // See if the specfile we started with (which might be the one registered in the interpreter)
                // doesn't match the name of the spec file
                if (
                    path.basename(path.dirname(kernel.kernelSpec.specFile)).toLowerCase() !=
                    kernel.kernelSpec.name.toLowerCase()
                ) {
                    // This means the specfile for the kernelspec will not be found by jupyter. We need to
                    // register it
                    await this.registerKernel(kernel, token);
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
        kernel: LocalKernelConnectionMetadata,
        cancelToken?: CancellationToken
    ): Promise<void> {
        // Get the global kernel location
        const root = await this.kernelFinder.getKernelSpecRootPath();

        // If that didn't work, we can't continue
        if (!root || !kernel.kernelSpec || cancelToken?.isCancellationRequested || !kernel.kernelSpec.name) {
            return;
        }

        // Compute a new path for the kernelspec
        const kernelSpecFilePath = path.join(root, kernel.kernelSpec.name, 'kernel.json');

        // If this file already exists, we can just exit
        if (await this.fs.localFileExists(kernelSpecFilePath)) {
            return;
        }

        // If it doesn't exist, see if we had an original spec file that's different.
        const contents = { ...kernel.kernelSpec };
        if (kernel.kernelSpec.specFile && !this.fs.areLocalPathsSame(kernelSpecFilePath, kernel.kernelSpec.specFile)) {
            // Add extra metadata onto the contents. We'll use this
            // when searching for kernels later to remove duplicates.
            contents.metadata = {
                ...contents.metadata,
                originalSpecFile: kernel.kernelSpec.specFile
            };
        }
        // Make sure interpreter is in the metadata
        if (kernel.interpreter) {
            contents.metadata = {
                ...contents.metadata,
                interpreter: kernel.interpreter
            };
        }

        traceInfo(`RegisterKernel for ${kernel.id}`);

        // Write out the contents into the new spec file
        try {
            await this.fs.writeLocalFile(kernelSpecFilePath, JSON.stringify(contents, undefined, 4));
        } catch (ex) {
            sendTelemetryEvent(Telemetry.FailedToUpdateKernelSpec, undefined, undefined, ex, true);
            throw ex;
        }
        if (cancelToken?.isCancellationRequested) {
            return;
        }

        // Copy any other files over from the original directory (images most likely)
        if (contents.metadata?.originalSpecFile) {
            const originalSpecDir = path.dirname(contents.metadata?.originalSpecFile);
            const newSpecDir = path.dirname(kernelSpecFilePath);
            const otherFiles = await this.fs.searchLocal('*.*[^json]', originalSpecDir);
            await Promise.all(
                otherFiles.map(async (f) => {
                    const oldPath = path.join(originalSpecDir, f);
                    const newPath = path.join(newSpecDir, f);
                    await this.fs.copyLocal(oldPath, newPath);
                })
            );
        }

        sendTelemetryEvent(Telemetry.RegisterAndUseInterpreterAsKernel);
    }
    private async updateKernelEnvironment(
        interpreter: PythonEnvironment | undefined,
        kernel: IJupyterKernelSpec,
        cancelToken?: CancellationToken,
        forceWrite?: boolean
    ) {
        const kernelSpecRootPath = await this.kernelFinder.getKernelSpecRootPath();
        const specedKernel = kernel as JupyterKernelSpec;
        if (specedKernel.specFile && kernelSpecRootPath) {
            // Spec file may not be the same as the original spec file path.
            const kernelSpecFilePath = specedKernel.specFile.includes(specedKernel.name)
                ? specedKernel.specFile
                : path.join(kernelSpecRootPath, specedKernel.name, 'kernel.json');

            // Make sure the file exists
            if (!(await this.fs.localFileExists(kernelSpecFilePath))) {
                return;
            }

            // Read spec from the file.
            let specModel: ReadWrite<Kernel.ISpecModel> = JSON.parse(await this.fs.readLocalFile(kernelSpecFilePath));
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
                try {
                    await this.fs.writeLocalFile(kernelSpecFilePath, JSON.stringify(specModel, undefined, 2));
                } catch (ex) {
                    sendTelemetryEvent(Telemetry.FailedToUpdateKernelSpec, undefined, undefined, ex, true);
                    throw ex;
                }
            }

            // Always update the metadata for the original kernel.
            specedKernel.metadata = specModel.metadata;
        }
    }
}
