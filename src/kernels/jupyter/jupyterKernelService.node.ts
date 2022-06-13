// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import type { KernelSpec } from '@jupyterlab/services';
import { inject, injectable } from 'inversify';
import * as path from '../../platform/vscode-path/path';
import * as uriPath from '../../platform/vscode-path/resources';
import { CancellationToken } from 'vscode';
import { Cancellation } from '../../platform/common/cancellation';
import '../../platform/common/extensions';
import {
    traceInfoIfCI,
    traceInfo,
    traceVerbose,
    logValue,
    ignoreLogging,
    traceDecoratorError
} from '../../platform/logging';
import { getDisplayPath } from '../../platform/common/platform/fs-paths';
import { IFileSystemNode } from '../../platform/common/platform/types.node';
import { Resource, ReadWrite, IDisplayOptions, IConfigurationService } from '../../platform/common/types';
import { noop } from '../../platform/common/utils/misc';
import { IEnvironmentVariablesService } from '../../platform/common/variables/types';
import { IEnvironmentActivationService } from '../../platform/interpreter/activation/types';
import { PythonEnvironment } from '../../platform/pythonEnvironments/info';
import { captureTelemetry, sendTelemetryEvent } from '../../telemetry';
import { Telemetry } from '../../telemetry';
import { JupyterKernelDependencyError } from '../../platform/errors/jupyterKernelDependencyError';
import { getKernelRegistrationInfo, cleanEnvironment } from '../helpers';
import { JupyterPaths } from '../raw/finder/jupyterPaths.node';
import {
    IJupyterKernelSpec,
    IKernelDependencyService,
    KernelConnectionMetadata,
    KernelInterpreterDependencyResponse,
    LocalKernelConnectionMetadata
} from '../types';
import { JupyterKernelSpec } from './jupyterKernelSpec';
import { serializePythonEnvironment } from '../../platform/api/pythonApi';
import { IJupyterKernelService } from './types';

/**
 * Responsible for registering and updating kernels
 *
 * @export
 * @class JupyterKernelService
 */
@injectable()
export class JupyterKernelService implements IJupyterKernelService {
    constructor(
        @inject(IKernelDependencyService) private readonly kernelDependencyService: IKernelDependencyService,
        @inject(IFileSystemNode) private readonly fs: IFileSystemNode,
        @inject(IEnvironmentActivationService) private readonly activationHelper: IEnvironmentActivationService,
        @inject(IEnvironmentVariablesService) private readonly envVarsService: IEnvironmentVariablesService,
        @inject(JupyterPaths) private readonly jupyterPaths: JupyterPaths,
        @inject(IConfigurationService) private readonly configService: IConfigurationService
    ) {}

    /**
     * Makes sure that the kernel pointed to is a valid jupyter kernel (it registers it) and
     * that is up to date relative to the interpreter that it might contain
     * @param resource
     * @param kernel
     */
    public async ensureKernelIsUsable(
        resource: Resource,
        @logValue<KernelConnectionMetadata>('id') kernel: KernelConnectionMetadata,
        @logValue<IDisplayOptions>('disableUI') ui: IDisplayOptions,
        @ignoreLogging() cancelToken: CancellationToken,
        cannotChangeKernels?: boolean
    ): Promise<void> {
        traceVerbose('Check if a kernel is usable');
        // If we have an interpreter, make sure it has the correct dependencies installed
        if (
            kernel.kind !== 'connectToLiveRemoteKernel' &&
            kernel.interpreter &&
            kernel.kind !== 'startUsingRemoteKernelSpec'
        ) {
            const result = await this.kernelDependencyService.installMissingDependencies(
                resource,
                kernel,
                ui,
                cancelToken,
                true,
                cannotChangeKernels
            );
            switch (result) {
                case KernelInterpreterDependencyResponse.cancel:
                case KernelInterpreterDependencyResponse.selectDifferentKernel:
                case KernelInterpreterDependencyResponse.failed:
                case KernelInterpreterDependencyResponse.uiHidden:
                    throw new JupyterKernelDependencyError(result, kernel);
                default:
                    break;
            }
        }

        var specFile: string | undefined = undefined;

        // If the spec file doesn't exist or is not defined, we need to register this kernel
        if (
            kernel.kind !== 'connectToLiveRemoteKernel' &&
            kernel.kind !== 'startUsingRemoteKernelSpec' &&
            kernel.kernelSpec &&
            kernel.interpreter
        ) {
            // Default to the kernel spec file.
            specFile = kernel.kernelSpec.specFile;

            if (!specFile || !(await this.fs.localFileExists(specFile))) {
                specFile = await this.registerKernel(kernel, cancelToken);
            }
            // Special case. If the original spec file came from an interpreter, we may need to register a kernel
            else if (kernel.interpreter && specFile) {
                // See if the specfile we started with (which might be the one registered in the interpreter)
                // doesn't match the name of the spec file
                if (path.basename(path.dirname(specFile)).toLowerCase() != kernel.kernelSpec.name.toLowerCase()) {
                    // This means the specfile for the kernelspec will not be found by jupyter. We need to
                    // register it
                    specFile = await this.registerKernel(kernel, cancelToken);
                }
            }
        }

        // Update the kernel environment to use the interpreter's latest
        if (
            kernel.kind !== 'connectToLiveRemoteKernel' &&
            kernel.kind !== 'startUsingRemoteKernelSpec' &&
            kernel.kernelSpec &&
            kernel.interpreter &&
            specFile
        ) {
            traceInfoIfCI(
                `updateKernelEnvironment ${kernel.interpreter.displayName}, ${getDisplayPath(
                    kernel.interpreter.uri
                )} for ${kernel.id}`
            );
            await this.updateKernelEnvironment(resource, kernel.interpreter, kernel.kernelSpec, specFile, cancelToken);
        }
    }

    /**
     * Registers an interpreter as a kernel.
     * The assumption is that `ipykernel` has been installed in the interpreter.
     * Kernel created will have following characteristics:
     * - display_name = Display name of the interpreter.
     * - metadata.interpreter = Interpreter information (useful in finding a kernel that matches a given interpreter)
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
    @traceDecoratorError('Failed to register an interpreter as a kernel')
    // eslint-disable-next-line
    private async registerKernel(
        kernel: LocalKernelConnectionMetadata,
        cancelToken: CancellationToken
    ): Promise<string | undefined> {
        // Get the global kernel location
        const root = await this.jupyterPaths.getKernelSpecTempRegistrationFolder();

        if (!kernel.kernelSpec || cancelToken.isCancellationRequested || !kernel.kernelSpec.name) {
            return;
        }

        // Compute a new path for the kernelspec
        const kernelSpecFilePath = uriPath.joinPath(root, kernel.kernelSpec.name, 'kernel.json');

        // If this file already exists, we can just exit
        if (await this.fs.localFileExists(kernelSpecFilePath.fsPath)) {
            return kernelSpecFilePath.fsPath;
        }

        // If it doesn't exist, see if we had an original spec file that's different.
        const contents = { ...kernel.kernelSpec };
        if (
            kernel.kernelSpec.specFile &&
            !this.fs.areLocalPathsSame(kernelSpecFilePath.fsPath, kernel.kernelSpec.specFile)
        ) {
            // Add extra metadata onto the contents. We'll use this
            // when searching for kernels later to remove duplicates.
            contents.metadata = contents.metadata || {};
            contents.metadata = {
                ...contents.metadata,
                vscode: {
                    ...(contents.metadata!.vscode || {}),
                    originalSpecFile:
                        kernel.kernelSpec.metadata?.vscode?.originalSpecFile || kernel.kernelSpec.specFile,
                    originalDisplayName:
                        kernel.kernelSpec.metadata?.vscode?.originalDisplayName || kernel.kernelSpec.display_name
                }
            };
        }
        // Make sure interpreter is in the metadata
        if (kernel.interpreter) {
            contents.metadata = {
                ...contents.metadata,
                interpreter: serializePythonEnvironment(kernel.interpreter)
            };
        }

        traceInfo(`RegisterKernel for ${kernel.id} into ${getDisplayPath(kernelSpecFilePath)}`);

        // Write out the contents into the new spec file
        try {
            await this.fs.writeLocalFile(kernelSpecFilePath.fsPath, JSON.stringify(contents, undefined, 4));
        } catch (ex) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sendTelemetryEvent(Telemetry.FailedToUpdateKernelSpec, undefined, undefined, ex as any, true);
            throw ex;
        }
        if (cancelToken.isCancellationRequested) {
            return;
        }

        // Copy any other files over from the original directory (images most likely)
        const originalSpecFile = contents.metadata?.vscode?.originalSpecFile || contents.metadata?.originalSpecFile;
        if (originalSpecFile) {
            const originalSpecDir = path.dirname(originalSpecFile);
            const newSpecDir = path.dirname(kernelSpecFilePath.fsPath);
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
        return kernelSpecFilePath.fsPath;
    }
    private async updateKernelEnvironment(
        resource: Resource,
        interpreter: PythonEnvironment,
        kernel: IJupyterKernelSpec,
        specFile: string,
        cancelToken?: CancellationToken,
        forceWrite?: boolean
    ) {
        const kernelSpecRootPath = await this.jupyterPaths.getKernelSpecTempRegistrationFolder();
        const specedKernel = kernel as JupyterKernelSpec;
        if (specFile && kernelSpecRootPath) {
            // Spec file may not be the same as the original spec file path.
            const kernelSpecFilePath =
                path.basename(specFile).toLowerCase() === kernel.name.toLowerCase()
                    ? specFile
                    : uriPath.joinPath(kernelSpecRootPath, kernel.name, 'kernel.json').fsPath;

            // Make sure the file exists
            if (!(await this.fs.localFileExists(kernelSpecFilePath))) {
                return;
            }

            // Read spec from the file.
            let specModel: ReadWrite<KernelSpec.ISpecModel> = JSON.parse(
                await this.fs.readLocalFile(kernelSpecFilePath)
            );
            let shouldUpdate = false;

            // Make sure the specmodel has an interpreter or already in the metadata or we
            // may overwrite a kernel created by the user
            if (specModel.metadata?.interpreter || forceWrite) {
                // Ensure we use a fully qualified path to the python interpreter in `argv`.
                if (specModel.argv[0].toLowerCase() === 'conda') {
                    // If conda is the first word, its possible its a conda activation command.
                    traceInfo(`Spec argv[0], not updated as it is using conda.`);
                } else {
                    traceInfo(
                        `Spec argv[0] updated from '${specModel.argv[0]}' to '${getDisplayPath(interpreter.uri)}'`
                    );
                    specModel.argv[0] = interpreter.uri.fsPath;
                }
                // Get the activated environment variables (as a work around for `conda run` and similar).
                // This ensures the code runs within the context of an activated environment.
                const interpreterEnv = await this.activationHelper
                    .getActivatedEnvironmentVariables(resource, interpreter, true)
                    .catch(noop)
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    .then((env) => (env || {}) as any);

                // Ensure we inherit env variables from the original kernelspec file.
                let envInKernelSpecJson =
                    getKernelRegistrationInfo(kernel) === 'registeredByNewVersionOfExtForCustomKernelSpec'
                        ? specModel.env || {}
                        : {};

                // Give preferences to variables in the env file (except for `PATH`).
                envInKernelSpecJson = Object.assign({ ...interpreterEnv }, envInKernelSpecJson);
                if (interpreterEnv['PATH']) {
                    envInKernelSpecJson['PATH'] = interpreterEnv['PATH'];
                }
                if (interpreterEnv['Path']) {
                    envInKernelSpecJson['Path'] = interpreterEnv['Path'];
                }
                specModel.env = Object.assign(envInKernelSpecJson, specModel.env);

                // Ensure the python env folder is always at the top of the PATH, this way all executables from that env are used.
                // This way shell commands such as `!pip`, `!python` end up pointing to the right executables.
                // Also applies to `!java` where java could be an executable in the conda bin directory.
                if (specModel.env) {
                    this.envVarsService.prependPath(specModel.env as {}, path.dirname(interpreter.uri.fsPath));
                }

                // If user asks us to, set PYTHONNOUSERSITE
                // For more details see here https://github.com/microsoft/vscode-jupyter/issues/8553#issuecomment-997144591
                // https://docs.python.org/3/library/site.html#site.ENABLE_USER_SITE
                if (this.configService.getSettings(undefined).excludeUserSitePackages) {
                    specModel.env.PYTHONNOUSERSITE = 'True';
                }

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
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    sendTelemetryEvent(Telemetry.FailedToUpdateKernelSpec, undefined, undefined, ex as any, true);
                    throw ex;
                }
            }

            // Always update the metadata for the original kernel.
            specedKernel.metadata = specModel.metadata;
        }
    }
}
