// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { KernelSpec } from '@jupyterlab/services';
import { inject, injectable } from 'inversify';
import * as path from '../../../platform/vscode-path/path';
import * as uriPath from '../../../platform/vscode-path/resources';
import { CancellationToken, Uri } from 'vscode';
import {
    traceInfo,
    traceVerbose,
    traceDecoratorError,
    traceError,
    traceWarning,
    traceInfoIfCI
} from '../../../platform/logging';
import { getDisplayPath, getFilePath } from '../../../platform/common/platform/fs-paths';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import { Resource, ReadWrite, IDisplayOptions } from '../../../platform/common/types';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { capturePerfTelemetry, sendTelemetryEvent, Telemetry } from '../../../telemetry';
import { JupyterKernelDependencyError } from '../../errors/jupyterKernelDependencyError';
import { cleanEnvironment } from '../../helpers';
import { JupyterPaths } from '../../raw/finder/jupyterPaths.node';
import {
    IJupyterKernelSpec,
    IKernelDependencyService,
    isLocalConnection,
    KernelConnectionMetadata,
    KernelInterpreterDependencyResponse,
    LocalKernelConnectionMetadata
} from '../../types';
import { JupyterKernelSpec } from '../jupyterKernelSpec';
import { serializePythonEnvironment } from '../../../platform/api/pythonApi';
import { IJupyterKernelService } from '../types';
import { arePathsSame } from '../../../platform/common/platform/fileUtils';
import { KernelEnvironmentVariablesService } from '../../raw/launcher/kernelEnvVarsService.node';
import { isKernelLaunchedViaLocalPythonIPyKernel } from '../../helpers.node';

/**
 * Responsible for registering and updating kernels in a non ZMQ situation (kernel specs)
 *
 * @export
 * @class JupyterKernelService
 */
@injectable()
export class JupyterKernelService implements IJupyterKernelService {
    constructor(
        @inject(IKernelDependencyService) private readonly kernelDependencyService: IKernelDependencyService,
        @inject(IFileSystemNode) private readonly fs: IFileSystemNode,
        @inject(JupyterPaths) private readonly jupyterPaths: JupyterPaths,
        @inject(KernelEnvironmentVariablesService) private readonly kernelEnvVars: KernelEnvironmentVariablesService
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
        ui: IDisplayOptions,
        cancelToken: CancellationToken,
        cannotChangeKernels?: boolean
    ): Promise<void> {
        traceVerbose(`Check if a kernel ${kernel.id} is usable`);
        // When dealing with Python kernels, and we have an interpreter, make sure it has the correct dependencies installed
        if (isKernelLaunchedViaLocalPythonIPyKernel(kernel) && kernel.interpreter) {
            const result = await this.kernelDependencyService.installMissingDependencies({
                resource,
                kernelConnection: kernel,
                ui,
                token: cancelToken,
                ignoreCache: true,
                cannotChangeKernels
            });
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
        if (isLocalConnection(kernel)) {
            // Default to the kernel spec file.
            specFile = kernel.kernelSpec.specFile;

            if (!specFile || !(await this.fs.exists(Uri.file(specFile)))) {
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

            // Update the kernel environment to use the interpreter's latest
            if (kernel.interpreter && specFile) {
                traceVerbose(`Updating Kernel Environment for ${kernel.id} for interpreter ${kernel.interpreter.id}`);
                await this.updateKernelEnvironment(resource, kernel, specFile, cancelToken);
            } else {
                traceVerbose(`Not Updating Kernel Environment for ${kernel.id}`);
            }
        }
    }

    /**
     * Registers an interpreter as a kernel.
     * The assumption is that `ipykernel` has been installed in the interpreter.
     * Kernel created will have following characteristics:
     * - display_name = Display name of the interpreter.
     * - metadata.interpreter = Interpreter information (useful in finding a kernel that matches a given interpreter)
     * - env = Will have environment variables of the activated environment.
     */
    @capturePerfTelemetry(Telemetry.RegisterInterpreterAsKernel)
    @traceDecoratorError('Failed to register an interpreter as a kernel')
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
        if (await this.fs.exists(kernelSpecFilePath)) {
            traceInfo(`Kernel spec file for ${kernel.id} already exists ${getDisplayPath(kernelSpecFilePath)}`);
            return kernelSpecFilePath.fsPath;
        }

        // If it doesn't exist, see if we had an original spec file that's different.
        const contents = { ...kernel.kernelSpec };
        if (kernel.kernelSpec.specFile && !arePathsSame(getFilePath(kernelSpecFilePath), kernel.kernelSpec.specFile)) {
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
        traceVerbose(
            `RegisterKernel for ${kernel.id} into ${getDisplayPath(kernelSpecFilePath)} with contents ${JSON.stringify(
                contents
            )}`
        );

        // Write out the contents into the new spec file
        try {
            await this.fs.writeFile(kernelSpecFilePath, JSON.stringify(contents, undefined, 4));
        } catch (ex) {
            const name = kernel.kernelSpec.name;
            const language = kernel.kernelSpec.language;
            sendTelemetryEvent(
                Telemetry.FailedToUpdateKernelSpec,
                undefined,
                { name, language, failed: true },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ex as any
            );
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
                    await this.fs.copy(Uri.file(oldPath), Uri.file(newPath));
                })
            );
        }

        return kernelSpecFilePath.fsPath;
    }
    private async updateKernelEnvironment(
        resource: Resource,
        kernelConnection: LocalKernelConnectionMetadata,
        specFile: string,
        cancelToken?: CancellationToken
    ) {
        const interpreter: PythonEnvironment = kernelConnection.interpreter!;
        const kernel: IJupyterKernelSpec = kernelConnection.kernelSpec;
        const kernelSpecRootPath = await this.jupyterPaths.getKernelSpecTempRegistrationFolder();
        const specedKernel = kernel as JupyterKernelSpec;
        if (specFile && kernelSpecRootPath) {
            // Spec file may not be the same as the original spec file path.
            const kernelSpecFilePath =
                path.basename(specFile).toLowerCase() === kernel.name.toLowerCase()
                    ? specFile
                    : uriPath.joinPath(kernelSpecRootPath, kernel.name, 'kernel.json').fsPath;

            // Make sure the file exists
            if (!(await this.fs.exists(Uri.file(kernelSpecFilePath)))) {
                traceWarning(
                    `Spec file for ${kernelConnection.id} does not exist ${kernelSpecFilePath} hence not updating env vars.`
                );
                return;
            }
            const uri = Uri.file(kernelSpecFilePath);
            try {
                // Read spec from the file.
                let specModel: ReadWrite<KernelSpec.ISpecModel> = JSON.parse(await this.fs.readFile(uri));
                if (cancelToken?.isCancellationRequested) {
                    return;
                }

                // Make sure the specmodel has an interpreter or already in the metadata or we
                // may overwrite a kernel created by the user
                if (specModel.metadata?.interpreter) {
                    // Ensure we use a fully qualified path to the python interpreter in `argv`.
                    if (isKernelLaunchedViaLocalPythonIPyKernel(kernel)) {
                        traceVerbose(
                            `Python KernelSpec argv[0] updated for ${kernelConnection.id} from '${
                                specModel.argv[0]
                            }' to '${getDisplayPath(interpreter.uri)}'`
                        );
                        specModel.argv[0] = interpreter.uri.fsPath;
                    }

                    // Ensure we update the metadata to include interpreter stuff as well (we'll use this to search kernels that match an interpreter).
                    // We'll need information such as interpreter type, display name, path, etc...
                    // Its just a JSON file, and the information is small, hence might as well store everything.
                    specModel.metadata = specModel.metadata || {};
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    specModel.metadata.interpreter = interpreter as any;
                } else {
                    traceVerbose(`KernelSpec argv[0] not updated for ${kernelConnection.id} ('${specModel.argv[0]}')`);
                }

                specModel.env = await this.kernelEnvVars.getEnvironmentVariables(resource, interpreter, specedKernel);

                // Scrub the environment of the specmodel to make sure it has allowed values (they all must be strings)
                // See this issue here: https://github.com/microsoft/vscode-python/issues/11749
                specModel = cleanEnvironment(specModel);

                // Update the kernel.json with our new stuff.
                await this.fs.writeFile(uri, JSON.stringify(specModel, undefined, 2));
                traceVerbose(
                    `Updated kernel spec for ${kernelConnection.id} with environment variables for ${getDisplayPath(
                        uri
                    )}`
                );
                traceInfoIfCI(
                    `Updated kernel spec for ${kernelConnection.id} with environment variables for ${getDisplayPath(
                        uri
                    )} with env variables ${JSON.stringify(specModel.env)}}`
                );

                if (cancelToken?.isCancellationRequested) {
                    return;
                }

                // Always update the metadata for the original kernel.
                specedKernel.metadata = specModel.metadata;
            } catch (ex) {
                if (cancelToken?.isCancellationRequested) {
                    return;
                }
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                sendTelemetryEvent(Telemetry.FailedToUpdateKernelSpec, undefined, undefined, ex as any);
                traceError(
                    `Failed to update kernel spec for ${
                        kernelConnection.id
                    } with environment variables for ${getDisplayPath(uri)}`,
                    ex
                );
                throw ex;
            }
        } else {
            traceWarning(`Either Kernel spec file or root spec file path does not exist for ${kernelConnection.id}.`);
        }
    }
}
