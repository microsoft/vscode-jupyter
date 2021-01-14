// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import type { nbformat } from '@jupyterlab/coreutils';
import type { Kernel } from '@jupyterlab/services';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import * as uuid from 'uuid/v4';
import { CancellationToken, CancellationTokenSource } from 'vscode';
import { Cancellation, wrapCancellationTokens } from '../../../common/cancellation';
import { PYTHON_LANGUAGE, PYTHON_WARNINGS } from '../../../common/constants';
import '../../../common/extensions';
import { traceDecorators, traceError, traceInfo, traceVerbose, traceWarning } from '../../../common/logger';
import { IFileSystem } from '../../../common/platform/types';

import { IPythonExecutionFactory } from '../../../common/process/types';
import { ReadWrite } from '../../../common/types';
import { sleep } from '../../../common/utils/async';
import { noop } from '../../../common/utils/misc';
import { IEnvironmentActivationService } from '../../../interpreter/activation/types';
import { IInterpreterService } from '../../../interpreter/contracts';
import { PythonEnvironment } from '../../../pythonEnvironments/info';
import { captureTelemetry, sendTelemetryEvent } from '../../../telemetry';
import { getRealPath } from '../../common';
import { Telemetry } from '../../constants';
import { reportAction } from '../../progress/decorator';
import { ReportableAction } from '../../progress/types';
import {
    IJupyterKernelSpec,
    IJupyterSessionManager,
    IJupyterSubCommandExecutionService,
    IKernelDependencyService,
    KernelInterpreterDependencyResponse
} from '../../types';
import { cleanEnvironment, detectDefaultKernelName } from './helpers';
import { JupyterKernelSpec } from './jupyterKernelSpec';
import { LiveKernelModel } from './types';

// tslint:disable-next-line: no-var-requires no-require-imports
const NamedRegexp = require('named-js-regexp') as typeof import('named-js-regexp');

/**
 * Helper to ensure we can differentiate between two types in union types, keeping typing information.
 * (basically avoiding the need to case using `as`).
 * We cannot use `xx in` as jupyter uses `JSONObject` which is too broad and captures anything and everything.
 *
 * @param {(nbformat.IKernelspecMetadata | PythonEnvironment)} item
 * @returns {item is PythonEnvironment}
 */
function isInterpreter(item: nbformat.IKernelspecMetadata | PythonEnvironment): item is PythonEnvironment {
    // Interpreters will not have a `display_name` property, but have `path` and `type` properties.
    return !!(item as PythonEnvironment).path && !(item as nbformat.IKernelspecMetadata).display_name;
}

/**
 * Responsible for kernel management and the like.
 *
 * @export
 * @class KernelService
 */
@injectable()
export class KernelService {
    constructor(
        @inject(IJupyterSubCommandExecutionService)
        private readonly jupyterInterpreterExecService: IJupyterSubCommandExecutionService,
        @inject(IPythonExecutionFactory) private readonly execFactory: IPythonExecutionFactory,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(IKernelDependencyService) private readonly kernelDependencyService: IKernelDependencyService,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IEnvironmentActivationService) private readonly activationHelper: IEnvironmentActivationService
    ) {}
    /**
     * Finds a kernel spec from a given session or jupyter process that matches a given spec.
     *
     * @param {nbformat.IKernelspecMetadata} kernelSpec The kernelspec (criteria) to be used when searching for a kernel.
     * @param {IJupyterSessionManager} [sessionManager] If not provided search against the jupyter process.
     * @param {CancellationToken} [cancelToken]
     * @returns {(Promise<IJupyterKernelSpec | undefined>)}
     * @memberof KernelService
     */
    public async findMatchingKernelSpec(
        kernelSpec: nbformat.IKernelspecMetadata,
        sessionManager?: IJupyterSessionManager,
        cancelToken?: CancellationToken
    ): Promise<IJupyterKernelSpec | undefined>;
    /**
     * Finds a kernel spec from a given session or jupyter process that matches a given interpreter.
     *
     * @param {PythonEnvironment} interpreter The interpreter (criteria) to be used when searching for a kernel.
     * @param {(IJupyterSessionManager | undefined)} sessionManager If not provided search against the jupyter process.
     * @param {CancellationToken} [cancelToken]
     * @returns {(Promise<IJupyterKernelSpec | undefined>)}
     * @memberof KernelService
     */
    public async findMatchingKernelSpec(
        interpreter: PythonEnvironment,
        sessionManager?: IJupyterSessionManager | undefined,
        cancelToken?: CancellationToken
    ): Promise<IJupyterKernelSpec | undefined>;
    public async findMatchingKernelSpec(
        option: nbformat.IKernelspecMetadata | PythonEnvironment,
        sessionManager: IJupyterSessionManager | undefined,
        cancelToken?: CancellationToken
    ): Promise<IJupyterKernelSpec | undefined> {
        const specs = await this.getKernelSpecs(sessionManager, cancelToken);
        if (isInterpreter(option)) {
            return specs.find((item) => {
                if (item.language?.toLowerCase() !== PYTHON_LANGUAGE.toLowerCase()) {
                    return false;
                }
                return (
                    this.fs.areLocalPathsSame(item.argv[0], option.path) ||
                    this.fs.areLocalPathsSame(item.metadata?.interpreter?.path || '', option.path)
                );
            });
        } else {
            return specs.find((item) => item.display_name === option.display_name && item.name === option.name);
        }
    }

    /**
     * Given a kernel, this will find an interpreter that matches the kernel spec.
     * Note: When we create our own kernels on behalf of the user, the meta data contains the interpreter information.
     *
     * @param {IJupyterKernelSpec} kernelSpec
     * @param {CancellationToken} [cancelToken]
     * @returns {(Promise<PythonEnvironment | undefined>)}
     * @memberof KernelService
     */
    // tslint:disable-next-line: cyclomatic-complexity
    public async findMatchingInterpreter(
        kernelSpec: IJupyterKernelSpec | LiveKernelModel,
        cancelToken?: CancellationToken
    ): Promise<PythonEnvironment | undefined> {
        // If we know for a fact that the kernel spec is a Non-Python kernel, then return nothing.
        if (kernelSpec?.language && kernelSpec.language !== PYTHON_LANGUAGE) {
            return;
        }

        const activeInterpreterPromise = this.interpreterService.getActiveInterpreter(undefined);
        const allInterpretersPromise = this.interpreterService.getInterpreters(undefined);
        // Ensure we handle errors if any (this is required to ensure we do not exit this function without using this promise).
        // If promise is rejected and we do not use it, then ignore errors.
        activeInterpreterPromise.ignoreErrors();
        // Ensure we handle errors if any (this is required to ensure we do not exit this function without using this promise).
        // If promise is rejected and we do not use it, then ignore errors.
        allInterpretersPromise.ignoreErrors();

        // 1. Check if current interpreter has the same path
        const interpreterPath = kernelSpec.metadata?.interpreter?.path || kernelSpec.interpreterPath;
        if (interpreterPath) {
            const interpreter = await this.interpreterService.getInterpreterDetails(interpreterPath);
            if (interpreter) {
                traceInfo(
                    `Found matching interpreter based on metadata, for the kernel ${kernelSpec.name}, ${kernelSpec.display_name}`
                );
                return interpreter;
            }
            traceError(
                `KernelSpec has interpreter information, however a matching interpreter could not be found for ${interpreterPath}`
            );
        }

        // 2. Check if we have a fully qualified path in `argv`
        const pathInArgv =
            Array.isArray(kernelSpec.argv) && kernelSpec.argv.length > 0 ? kernelSpec.argv[0] : undefined;
        if (pathInArgv && path.basename(pathInArgv) !== pathInArgv) {
            const interpreter = await this.interpreterService.getInterpreterDetails(pathInArgv).catch((ex) => {
                traceError(
                    `Failed to get interpreter information for python defined in kernel ${kernelSpec.name}, ${
                        kernelSpec.display_name
                    } with argv: ${(kernelSpec.argv || [])?.join(',')}`,
                    ex
                );
                return;
            });
            if (interpreter) {
                traceInfo(
                    `Found matching interpreter based on metadata, for the kernel ${kernelSpec.name}, ${kernelSpec.display_name}`
                );
                return interpreter;
            }
            traceError(
                `KernelSpec has path information, however a matching interpreter could not be found for ${kernelSpec.metadata?.interpreter?.path}`
            );
        }
        if (Cancellation.isCanceled(cancelToken)) {
            return;
        }

        // 3. Check if current interpreter has the same display name
        const activeInterpreter = await activeInterpreterPromise;
        // If the display name matches the active interpreter then use that.
        if (kernelSpec.display_name === activeInterpreter?.displayName) {
            return activeInterpreter;
        }

        // Check if kernel is `Python2` or `Python3` or a similar generic kernel.
        const match = detectDefaultKernelName(kernelSpec.name);
        if (match && match.groups()) {
            // 3. Look for interpreter with same major version

            const majorVersion = parseInt(match.groups()!.version, 10) || 0;
            // If the major versions match, that's sufficient.
            if (!majorVersion || (activeInterpreter?.version && activeInterpreter.version.major === majorVersion)) {
                traceInfo(`Using current interpreter for kernel ${kernelSpec.name}, ${kernelSpec.display_name}`);
                return activeInterpreter;
            }

            // Find an interpreter that matches the
            const allInterpreters = await allInterpretersPromise;
            const found = allInterpreters.find((item) => item.version?.major === majorVersion);

            // If we cannot find a matching one, then use the current interpreter.
            if (found) {
                traceVerbose(
                    `Using interpreter ${found.path} for the kernel ${kernelSpec.name}, ${kernelSpec.display_name}`
                );
                return found;
            }

            traceWarning(
                `Unable to find an interpreter that matches the kernel ${kernelSpec.name}, ${kernelSpec.display_name}, some features might not work.`
            );
            return activeInterpreter;
        } else {
            // 5. Look for interpreter with same display name across all interpreters.

            // If the display name matches the active interpreter then use that.
            // Look in all of our interpreters if we have something that matches this.
            const allInterpreters = await allInterpretersPromise;
            if (Cancellation.isCanceled(cancelToken)) {
                return;
            }

            const found = allInterpreters.find((item) => item.displayName === kernelSpec.display_name);

            if (found) {
                traceVerbose(
                    `Found an interpreter that has the same display name as kernelspec ${kernelSpec.display_name}, matches ${found.path}`
                );
                return found;
            } else {
                traceWarning(
                    `Unable to determine version of Python interpreter to use for kernel ${kernelSpec.name}, ${kernelSpec.display_name}, some features might not work.`
                );
                return activeInterpreter;
            }
        }
    }
    public async searchAndRegisterKernel(
        interpreter: PythonEnvironment,
        disableUI?: boolean,
        cancelToken?: CancellationToken
    ): Promise<IJupyterKernelSpec | undefined> {
        // If a kernelspec already exists for this, then use that.
        const found = await this.findMatchingKernelSpec(interpreter, undefined, cancelToken);
        if (found) {
            sendTelemetryEvent(Telemetry.UseExistingKernel);

            // Make sure the kernel is up to date with the current environment before
            // we return it.
            await this.updateKernelEnvironment(interpreter, found, cancelToken);

            return found;
        }
        return this.registerKernel(interpreter, disableUI, cancelToken);
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
    // tslint:disable-next-line: max-func-body-length
    // tslint:disable-next-line: cyclomatic-complexity
    @captureTelemetry(Telemetry.RegisterInterpreterAsKernel, undefined, true)
    @traceDecorators.error('Failed to register an interpreter as a kernel')
    @reportAction(ReportableAction.KernelsRegisterKernel)
    // tslint:disable-next-line:max-func-body-length
    public async registerKernel(
        interpreter: PythonEnvironment,
        disableUI?: boolean,
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
        const name = this.generateKernelNameForInterpreter(interpreter);
        // If ipykernel is not installed, prompt to install it.
        if (!(await this.kernelDependencyService.areDependenciesInstalled(interpreter, cancelToken)) && !disableUI) {
            // If we wish to wait for installation to complete, we must provide a cancel token.
            const token = new CancellationTokenSource();
            const response = await this.kernelDependencyService.installMissingDependencies(
                interpreter,
                wrapCancellationTokens(cancelToken, token.token)
            );
            if (response !== KernelInterpreterDependencyResponse.ok) {
                traceWarning(
                    `Prompted to install ipykernel, however ipykernel not installed in the interpreter ${interpreter.path}. Response ${response}`
                );
                return;
            }
        }

        if (Cancellation.isCanceled(cancelToken)) {
            return;
        }

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

        let kernel = await this.findMatchingKernelSpec(
            { display_name: interpreter.displayName, name },
            undefined,
            cancelToken
        );
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
            kernel = await this.findMatchingKernelSpec(
                { display_name: interpreter.displayName, name },
                undefined,
                cancelToken
            );
        }
        if (!kernel) {
            // Possible user doesn't have kernelspec installed.
            kernel = await this.getKernelSpecFromStdOut(await execService.getExecutablePath(), output.stdout).catch(
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

        // Update the json with our environment.
        await this.updateKernelEnvironment(interpreter, kernel, cancelToken, true);

        sendTelemetryEvent(Telemetry.RegisterAndUseInterpreterAsKernel);
        traceInfo(
            `Kernel successfully registered for ${interpreter.path} with the name=${name} and spec can be found here ${kernel.specFile}`
        );
        return kernel;
    }
    public async updateKernelEnvironment(
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
                    // tslint:disable-next-line: no-any
                    .then((env) => (env || {}) as any);
                if (Cancellation.isCanceled(cancelToken)) {
                    return;
                }

                // Special case, modify the PYTHONWARNINGS env to the global value.
                // otherwise it's forced to 'ignore' because activated variables are cached.
                if (specModel.env && process.env[PYTHON_WARNINGS]) {
                    // tslint:disable-next-line:no-any
                    specModel.env[PYTHON_WARNINGS] = process.env[PYTHON_WARNINGS] as any;
                } else if (specModel.env && specModel.env[PYTHON_WARNINGS]) {
                    delete specModel.env[PYTHON_WARNINGS];
                }
                // Ensure we update the metadata to include interpreter stuff as well (we'll use this to search kernels that match an interpreter).
                // We'll need information such as interpreter type, display name, path, etc...
                // Its just a JSON file, and the information is small, hence might as well store everything.
                specModel.metadata = specModel.metadata || {};
                // tslint:disable-next-line: no-any
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
     * Gets a list of all kernel specs.
     *
     * @param {IJupyterSessionManager} [sessionManager]
     * @param {CancellationToken} [cancelToken]
     * @returns {Promise<IJupyterKernelSpec[]>}
     * @memberof KernelService
     */
    @reportAction(ReportableAction.KernelsGetKernelSpecs)
    public async getKernelSpecs(
        sessionManager?: IJupyterSessionManager,
        cancelToken?: CancellationToken
    ): Promise<IJupyterKernelSpec[]> {
        const enumerator = sessionManager
            ? sessionManager.getKernelSpecs()
            : this.jupyterInterpreterExecService.getKernelSpecs(cancelToken);
        if (Cancellation.isCanceled(cancelToken)) {
            return [];
        }
        traceInfo('Enumerating kernel specs...');
        const specs: IJupyterKernelSpec[] = await enumerator;
        const result = specs.filter((item) => !!item);
        traceInfo(`Found ${result.length} kernelspecs`);

        // Send telemetry on this enumeration.
        const anyPython = result.find((k) => k.language === 'python') !== undefined;
        sendTelemetryEvent(Telemetry.KernelEnumeration, undefined, {
            count: result.length,
            isPython: anyPython,
            source: sessionManager ? 'connection' : 'cli'
        });

        return result;
    }
    /**
     * Not all characters are allowed in a kernel name.
     * This method will generate a name for a kernel based on display name and path.
     * Algorithm = <displayname - invalid characters> + <hash of path>
     *
     * @private
     * @param {PythonEnvironment} interpreter
     * @memberof KernelService
     */
    private generateKernelNameForInterpreter(interpreter: PythonEnvironment): string {
        // Never change this logic, this is used in other places to determine the format of names we have generated.
        return `${interpreter.displayName || ''}${uuid()}`.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
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
    private async getKernelSpecFromStdOut(pythonPath: string, output: string): Promise<JupyterKernelSpec | undefined> {
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
            this.fs,
            this.execFactory,
            pythonPath,
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
