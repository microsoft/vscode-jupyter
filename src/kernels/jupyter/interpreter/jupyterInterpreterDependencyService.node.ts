// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { CancellationToken, CancellationTokenSource } from 'vscode';
import { IApplicationShell } from '../../../platform/common/application/types';
import { raceCancellation } from '../../../platform/common/cancellation';
import { traceError } from '../../../platform/logging';
import { DataScience, Common } from '../../../platform/common/utils/localize';
import { noop } from '../../../platform/common/utils/misc';
import { EnvironmentType, PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { sendTelemetryEvent, Telemetry } from '../../../telemetry';
import { JupyterCommands } from '../../../platform/common/constants';
import { JupyterInstallError } from '../../../platform/errors/jupyterInstallError';
import { ProductNames } from '../../../platform/interpreter/installer/productNames';
import { Product, IInstaller, InstallerResponse } from '../../../platform/interpreter/installer/types';
import { HelpLinks } from '../../../platform/common/constants';
import { reportAction } from '../../../platform/progress/decorator';
import { ReportableAction } from '../../../platform/progress/types';
import { JupyterInterpreterDependencyResponse } from '../types';
import { IJupyterCommandFactory } from '../types.node';
import { getComparisonKey } from '../../../platform/vscode-path/resources';

/**
 * Sorts the given list of products (in place) in the order in which they need to be installed.
 * E.g. when installing the modules `notebook` and `Jupyter`, its best to first install `Jupyter`.
 *
 * @param {Product[]} products
 */
function sortProductsInOrderForInstallation(products: Product[]) {
    products.sort((a, b) => {
        if (a === Product.jupyter) {
            return -1;
        }
        if (b === Product.jupyter) {
            return 1;
        }
        if (a === Product.notebook) {
            return -1;
        }
        if (b === Product.notebook) {
            return 1;
        }
        return 0;
    });
}
/**
 * Given a list of products, this will return an error message of the form:
 * `Data Science library jupyter not installed`
 * `Data Science libraries, jupyter and notebook not installed`
 * `Data Science libraries, jupyter, notebook and nbconvert not installed`
 *
 * @export
 * @param {Product[]} products
 * @param {string} [interpreterName]
 * @returns {string}
 */
export function getMessageForLibrariesNotInstalled(products: Product[], interpreter: PythonEnvironment): string {
    const interpreterName =
        interpreter.displayName || interpreter.envName || interpreter.envPath?.fsPath || interpreter.uri.fsPath;
    // Even though kernelspec cannot be installed, display it so user knows what is missing.
    const names = products
        .map((product) => ProductNames.get(product))
        .filter((name) => !!name)
        .map((name) => name as string);

    switch (names.length) {
        case 0:
            return '';
        case 1:
            return interpreterName
                ? DataScience.libraryRequiredToLaunchJupyterNotInstalledInterpreter(interpreterName, names[0])
                : DataScience.libraryRequiredToLaunchJupyterNotInstalled(names[0]);
        default: {
            const lastItem = names.pop();
            return interpreterName
                ? DataScience.librariesRequiredToLaunchJupyterNotInstalledInterpreter(
                      interpreterName,
                      `${names.join(', ')} ${Common.and} ${lastItem}`
                  )
                : DataScience.librariesRequiredToLaunchJupyterNotInstalled(
                      `${names.join(', ')} ${Common.and} ${lastItem}`
                  );
        }
    }
}

/**
 * Responsible for managing dependencies of a Python interpreter required to run Jupyter.
 * If required modules aren't installed, will prompt user to install them or select another interpreter.
 *
 * @export
 * @class JupyterInterpreterDependencyService
 */
@injectable()
export class JupyterInterpreterDependencyService {
    /**
     * Keeps track of the fact that all dependencies are available in an interpreter.
     * This cache will be cleared only after reloading VS Code or when the background code detects that modules are not available.
     * E.g. every time a user makes a request to get the interpreter information, we use the cache if everything is ok.
     * However we still run the code in the background to check if the modules are available, and then update the cache with the results.
     *
     * @private
     * @memberof JupyterInterpreterDependencyService
     */
    private readonly dependenciesInstalledInInterpreter = new Set<string>();
    constructor(
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(IInstaller) private readonly installer: IInstaller,
        @inject(IJupyterCommandFactory) private readonly commandFactory: IJupyterCommandFactory
    ) {}
    /**
     * Configures the python interpreter to ensure it can run Jupyter server by installing any missing dependencies.
     * If user opts not to install they can opt to select another interpreter.
     *
     * @param {PythonEnvironment} interpreter
     * @param {JupyterInstallError} [_error]
     * @param {CancellationToken} [token]
     * @returns {Promise<JupyterInterpreterDependencyResponse>}
     * @memberof JupyterInterpreterDependencyService
     */
    @reportAction(ReportableAction.InstallingMissingDependencies)
    public async installMissingDependencies(
        interpreter: PythonEnvironment,
        _error?: JupyterInstallError
    ): Promise<JupyterInterpreterDependencyResponse> {
        const tokenSource = new CancellationTokenSource();
        try {
            // If we're dealing with a non-conda environment & pip isn't installed, we can't install anything.
            // Hence prompt to install pip as well.
            const pipInstalledInNonCondaEnvPromise =
                interpreter.envType === EnvironmentType.Conda
                    ? Promise.resolve(undefined)
                    : this.installer.isInstalled(Product.pip, interpreter);

            const [missingProducts, pipInstalledInNonCondaEnv] = await Promise.all([
                this.getDependenciesNotInstalled(interpreter, undefined),
                pipInstalledInNonCondaEnvPromise
            ]);
            if (missingProducts.length === 0) {
                return JupyterInterpreterDependencyResponse.ok;
            }

            const message = getMessageForLibrariesNotInstalled(
                pipInstalledInNonCondaEnv === false ? [Product.pip].concat(missingProducts) : missingProducts,
                interpreter
            );
            sendTelemetryEvent(Telemetry.PythonModuleInstall, undefined, {
                action: 'displayed',
                moduleName: ProductNames.get(Product.jupyter)!,
                pythonEnvType: interpreter.envType
            });
            const selection = await this.applicationShell.showErrorMessage(
                message,
                { modal: true },
                DataScience.jupyterInstall,
                DataScience.selectDifferentJupyterInterpreter
            );

            switch (selection) {
                case DataScience.jupyterInstall: {
                    // Ignore kernelspec as it not something that can be installed.
                    // If kernelspec isn't available, then re-install `Jupyter`.
                    if (missingProducts.includes(Product.kernelspec) && !missingProducts.includes(Product.jupyter)) {
                        missingProducts.push(Product.jupyter);
                    }
                    const productsToInstall = missingProducts.filter((product) => product !== Product.kernelspec);
                    // Install jupyter, then notebook, then others in that order.
                    sortProductsInOrderForInstallation(productsToInstall);

                    let productToInstall = productsToInstall.shift();
                    while (productToInstall) {
                        // Always pass a cancellation token to `install`, to ensure it waits until the module is installed.
                        const response = await raceCancellation(
                            tokenSource.token,
                            InstallerResponse.Ignore,
                            this.installer.install(
                                productToInstall,
                                interpreter,
                                tokenSource,
                                undefined,
                                pipInstalledInNonCondaEnv === false
                            )
                        );
                        if (response === InstallerResponse.Installed) {
                            productToInstall = productsToInstall.shift();
                            continue;
                        } else {
                            return JupyterInterpreterDependencyResponse.cancel;
                        }
                    }
                    sendTelemetryEvent(Telemetry.UserInstalledJupyter);

                    // Check if kernelspec module is something that accessible.
                    return this.checkKernelSpecAvailability(interpreter);
                }

                case DataScience.selectDifferentJupyterInterpreter: {
                    sendTelemetryEvent(Telemetry.UserDidNotInstallJupyter);
                    return JupyterInterpreterDependencyResponse.selectAnotherInterpreter;
                }

                case DataScience.pythonInteractiveHelpLink: {
                    this.applicationShell.openUrl(HelpLinks.PythonInteractiveHelpLink);
                    sendTelemetryEvent(Telemetry.UserDidNotInstallJupyter);
                    return JupyterInterpreterDependencyResponse.cancel;
                }

                default:
                    sendTelemetryEvent(Telemetry.UserDidNotInstallJupyter);
                    return JupyterInterpreterDependencyResponse.cancel;
            }
        } finally {
            tokenSource.dispose();
        }
    }
    /**
     * Whether all dependencies required to start & use a jupyter server are available in the provided interpreter.
     *
     * @param {PythonEnvironment} interpreter
     * @param {CancellationToken} [token]
     * @returns {Promise<boolean>}
     * @memberof JupyterInterpreterConfigurationService
     */
    public async areDependenciesInstalled(interpreter: PythonEnvironment, token?: CancellationToken): Promise<boolean> {
        return this.getDependenciesNotInstalled(interpreter, token).then((items) => items.length === 0);
    }

    /**
     * Gets a list of the dependencies not installed, dependencies that are required to launch the jupyter notebook server.
     *
     * @param {PythonEnvironment} interpreter
     * @param {CancellationToken} [token]
     * @returns {Promise<Product[]>}
     */
    public async getDependenciesNotInstalled(
        interpreter: PythonEnvironment,
        token?: CancellationToken
    ): Promise<Product[]> {
        // If we know that all modules were available at one point in time, then use that cache.
        const key = getComparisonKey(interpreter.uri);
        if (this.dependenciesInstalledInInterpreter.has(key)) {
            return [];
        }

        const notInstalled: Product[] = [];

        await raceCancellation(
            token,
            Promise.all([
                this.installer
                    .isInstalled(Product.jupyter, interpreter)
                    .then((installed) => (installed ? noop() : notInstalled.push(Product.jupyter))),
                this.installer
                    .isInstalled(Product.notebook, interpreter)
                    .then((installed) => (installed ? noop() : notInstalled.push(Product.notebook)))
            ])
        );

        if (notInstalled.length > 0) {
            return notInstalled;
        }
        if (token?.isCancellationRequested) {
            return [];
        }
        // Perform this check only if jupyter & notebook modules are installed.
        const products = await this.isKernelSpecAvailable(interpreter, token).then((installed) =>
            installed ? [] : [Product.kernelspec]
        );
        if (products.length === 0) {
            this.dependenciesInstalledInInterpreter.add(key);
        }
        return products;
    }

    /**
     * Checks whether the jupyter sub command kernelspec is available.
     *
     * @private
     * @param {PythonEnvironment} interpreter
     * @param {CancellationToken} [_token]
     * @returns {Promise<boolean>}
     */
    private async isKernelSpecAvailable(interpreter: PythonEnvironment, _token?: CancellationToken): Promise<boolean> {
        const command = this.commandFactory.createInterpreterCommand(
            JupyterCommands.KernelSpecCommand,
            'jupyter',
            ['-m', 'jupyter', 'kernelspec'],
            interpreter,
            false
        );
        return command
            .exec(['--version'], { throwOnStdErr: true })
            .then(() => true)
            .catch((e) => {
                traceError(`Kernel spec not found: `, e);
                return false;
            });
    }

    /**
     * Even if jupyter module is installed, its possible kernelspec isn't available.
     * Possible user has an old version of jupyter or something is corrupted.
     * This is an edge case, and we need to handle this.
     * Current solution is to get user to select another interpreter or update jupyter/python (we don't know what is wrong).
     *
     * @private
     * @param {PythonEnvironment} interpreter
     * @param {CancellationToken} [token]
     * @returns {Promise<JupyterInterpreterDependencyResponse>}
     */
    private async checkKernelSpecAvailability(
        interpreter: PythonEnvironment,
        token?: CancellationToken
    ): Promise<JupyterInterpreterDependencyResponse> {
        if (await this.isKernelSpecAvailable(interpreter)) {
            return JupyterInterpreterDependencyResponse.ok;
        }
        // Indicate no kernel spec module.
        if (token?.isCancellationRequested) {
            return JupyterInterpreterDependencyResponse.cancel;
        }
        const selectionFromError = await this.applicationShell.showErrorMessage(
            DataScience.jupyterKernelSpecModuleNotFound(interpreter.uri.fsPath),
            { modal: true },
            DataScience.selectDifferentJupyterInterpreter
        );
        return selectionFromError === DataScience.selectDifferentJupyterInterpreter
            ? JupyterInterpreterDependencyResponse.selectAnotherInterpreter
            : JupyterInterpreterDependencyResponse.cancel;
    }
}
