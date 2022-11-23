// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken, commands, NotebookDocument, Uri } from 'vscode';
import { DisplayOptions } from '../../kernels/displayOptions';
import { ContributedKernelFinderKind, IContributedKernelFinder } from '../../kernels/internalTypes';
import {
    IKernelDependencyService,
    IKernelFinder,
    KernelInterpreterDependencyResponse,
    PythonKernelConnectionMetadata
} from '../../kernels/types';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { getDisplayPath } from '../../platform/common/platform/fs-paths';
import { IDisposable } from '../../platform/common/types';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import { ServiceContainer } from '../../platform/ioc/container';
import { traceVerbose, traceWarning } from '../../platform/logging';
import { PythonEnvironment } from '../../platform/pythonEnvironments/info';

type CreateEnvironmentResult = {
    path: string | undefined;
};

/**
 * Responsible for creating a Python Environment for a given notebook & then finding the corresponding kernel connection for that env and returning that.
 */
export class PythonEnvKernelConnectionCreator {
    private readonly disposables: IDisposable[] = [];
    public dispose() {
        disposeAllDisposables(this.disposables);
    }
    /**
     * Creates a Python Environment & then returns the corresponding kernel connection for the newly created python env.
     */
    public async createPythonEnvFromKernelPicker(notebook: NotebookDocument, cancelToken: CancellationToken) {
        let env: PythonEnvironment | undefined;

        env = await this.createPythonEnvironment(cancelToken);
        if (cancelToken.isCancellationRequested || !env) {
            return;
        }
        traceVerbose(`Python Environment created ${env.id}`);

        const kernelConnection = await this.waitForPythonKernel(env, cancelToken);
        if (cancelToken.isCancellationRequested) {
            return;
        }
        if (!kernelConnection) {
            traceVerbose(`Python Environment ${env.id} not found as a kernel`);
            return;
        }
        traceVerbose(`Python Environment ${env.id} found as a kernel ${kernelConnection.kind}:${kernelConnection.id}`);
        const dependencyService = ServiceContainer.instance.get<IKernelDependencyService>(IKernelDependencyService);
        const result = await dependencyService.installMissingDependencies({
            resource: notebook.uri,
            kernelConnection,
            ui: new DisplayOptions(false),
            token: cancelToken,
            ignoreCache: false,
            cannotChangeKernels: true,
            installWithoutPrompting: true
        });
        if (result !== KernelInterpreterDependencyResponse.ok) {
            traceWarning(
                `Dependencies not installed for new Python Env ${getDisplayPath(env.uri)} for notebook ${getDisplayPath(
                    notebook.uri
                )}`
            );
        }

        return kernelConnection;
    }
    private async waitForPythonKernel(env: PythonEnvironment, cancelToken: CancellationToken) {
        const kernelFinder = ServiceContainer.instance.get<IKernelFinder>(IKernelFinder);
        const finder = kernelFinder.registered.find(
            (item) => item.kind === ContributedKernelFinderKind.LocalPythonEnvironment
        ) as IContributedKernelFinder<PythonKernelConnectionMetadata>;
        if (!finder) {
            return;
        }
        return this.waitForPythonKernelFromFinder(env, finder, cancelToken);
    }
    private async waitForPythonKernelFromFinder(
        env: PythonEnvironment,
        finder: IContributedKernelFinder<PythonKernelConnectionMetadata>,
        cancelToken: CancellationToken
    ) {
        const kernel = finder.kernels.find((item) => item.interpreter.id === env.id);
        if (kernel) {
            return kernel;
        }

        return new Promise<PythonKernelConnectionMetadata>((resolve) => {
            const disposables: IDisposable[] = [];
            disposables.push(
                finder.onDidChangeKernels(
                    () => {
                        if (cancelToken.isCancellationRequested) {
                            return;
                        }
                        const kernel = finder.kernels.find((item) => item.interpreter.id === env.id);
                        if (kernel) {
                            disposeAllDisposables(disposables);
                            return resolve(kernel);
                        }
                        // Keep waiting, for ever, until another controller is selected for this notebook.
                    },
                    this,
                    this.disposables
                )
            );

            disposables.push(
                cancelToken.onCancellationRequested(() => {
                    disposeAllDisposables(disposables);
                })
            );
        }).then((kernel) => {
            if (cancelToken.isCancellationRequested) {
                return;
            }
            if (!kernel) {
                traceWarning(`New Python Environment ${getDisplayPath(env.uri)} not found as a kernel`);
            }
            return kernel;
        });
    }
    private async createPythonEnvironment(cancelToken: CancellationToken) {
        const result: CreateEnvironmentResult = await commands.executeCommand('python.createEnvironment');
        const path = result?.path;
        if (cancelToken.isCancellationRequested) {
            return;
        }
        if (!path) {
            traceWarning(
                `Python Environment not created, either user cancelled the creation or there was an error in the Python Extension`
            );
            return;
        }
        traceVerbose(`Python Environment created ${path}`);
        const interpreterService = ServiceContainer.instance.get<IInterpreterService>(IInterpreterService);
        return interpreterService.getInterpreterDetails({ path }).then((env) => {
            if (cancelToken.isCancellationRequested) {
                return;
            }
            if (!env) {
                traceWarning(`No interpreter details for New Python Environment ${getDisplayPath(Uri.file(path))}`);
            }
            return env;
        });
    }
}
