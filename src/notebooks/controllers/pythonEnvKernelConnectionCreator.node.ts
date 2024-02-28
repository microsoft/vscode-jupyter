// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken, CancellationTokenSource, commands, NotebookDocument, Uri } from 'vscode';
import { DisplayOptions } from '../../kernels/displayOptions';
import { ContributedKernelFinderKind, IContributedKernelFinder } from '../../kernels/internalTypes';
import {
    IKernelDependencyService,
    IKernelFinder,
    KernelInterpreterDependencyResponse,
    PythonKernelConnectionMetadata
} from '../../kernels/types';
import { wrapCancellationTokens } from '../../platform/common/cancellation';
import { dispose } from '../../platform/common/utils/lifecycle';
import { getDisplayPath } from '../../platform/common/platform/fs-paths';
import { IDisposable } from '../../platform/common/types';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import { ServiceContainer } from '../../platform/ioc/container';
import { traceVerbose, traceWarning } from '../../platform/logging';
import { PythonEnvironment } from '../../platform/pythonEnvironments/info';
import { sendTelemetryEvent, Telemetry } from '../../telemetry';
import { IControllerRegistration } from './types';
import { getEnvironmentType } from '../../platform/interpreter/helpers';

type CreateEnvironmentResult = {
    path: string | undefined;
    action?: 'Back' | 'Cancel';
};

/**
 * Responsible for creating a Python Environment for a given notebook & then finding the corresponding kernel connection for that env and returning that.
 */
export class PythonEnvKernelConnectionCreator {
    private readonly disposables: IDisposable[] = [];
    private createdEnvId: string | undefined;
    private readonly cancelTokeSource;
    public dispose() {
        this.cancelTokeSource.dispose();
        dispose(this.disposables);
    }
    constructor(
        private readonly notebook: NotebookDocument,
        cancelToken: CancellationToken
    ) {
        const controllerSelection = ServiceContainer.instance.get<IControllerRegistration>(IControllerRegistration);
        // If user selects another controller for this notebook, then stop waiting for the environment to be created.
        controllerSelection.onControllerSelected(
            (e) => {
                // If the selected controller is for the new env, then continue waiting.
                // Else if user selects another controller for the same notebook, then stop
                if (
                    e.notebook === this.notebook &&
                    (e.controller.connection.kind !== 'startUsingPythonInterpreter' ||
                        !e.controller.connection.interpreter ||
                        e.controller.connection.interpreter.id !== this.createdEnvId)
                ) {
                    this.cancelTokeSource.cancel();
                }
            },
            this,
            this.disposables
        );

        this.cancelTokeSource = wrapCancellationTokens(cancelToken);
    }
    /**
     * Creates a Python Environment & then returns the corresponding kernel connection for the newly created python env.
     */
    public async createPythonEnvFromKernelPicker(): Promise<
        | {
              kernelConnection: PythonKernelConnectionMetadata;
          }
        | {
              action: 'Back' | 'Cancel';
          }
    > {
        let env: PythonEnvironment | undefined;

        const envResult = await this.createPythonEnvironment();
        if (this.cancelTokeSource.token.isCancellationRequested || envResult.action) {
            sendTelemetryEvent(Telemetry.CreatePythonEnvironment, undefined, { failed: true, reason: 'cancelled' });
            return { action: envResult.action || 'Cancel' };
        }
        if (!envResult.interpreter) {
            sendTelemetryEvent(Telemetry.CreatePythonEnvironment, undefined, { failed: true, reason: 'cancelled' });
            return { action: 'Cancel' };
        }
        env = envResult.interpreter;
        traceVerbose(`Python Environment created ${env.id}`);

        const kernelConnection = await this.waitForPythonKernel(envResult.interpreter);
        if (this.cancelTokeSource.token.isCancellationRequested) {
            sendTelemetryEvent(Telemetry.CreatePythonEnvironment, undefined, { failed: true, reason: 'cancelled' });
            return { action: 'Cancel' };
        }
        if (!kernelConnection) {
            sendTelemetryEvent(Telemetry.CreatePythonEnvironment, undefined, {
                failed: true,
                reason: 'kernelConnectionNotCreated'
            });
            traceVerbose(`Python Environment ${env.id} not found as a kernel`);
            return { action: 'Cancel' };
        }
        traceVerbose(`Python Environment ${env.id} found as a kernel ${kernelConnection.kind}:${kernelConnection.id}`);
        const dependencyService = ServiceContainer.instance.get<IKernelDependencyService>(IKernelDependencyService);
        const result = await dependencyService.installMissingDependencies({
            resource: this.notebook.uri,
            kernelConnection,
            ui: new DisplayOptions(false),
            token: this.cancelTokeSource.token,
            ignoreCache: true,
            cannotChangeKernels: true,
            installWithoutPrompting: true
        });
        let dependenciesInstalled = true;
        if (result !== KernelInterpreterDependencyResponse.ok) {
            dependenciesInstalled = false;
            traceWarning(
                `Dependencies not installed for new Python Env ${getDisplayPath(env.uri)} for notebook ${getDisplayPath(
                    this.notebook.uri
                )}`
            );
        }

        sendTelemetryEvent(Telemetry.CreatePythonEnvironment, undefined, {
            dependenciesInstalled,
            envType: getEnvironmentType(envResult.interpreter)
        });
        return { kernelConnection };
    }
    private async waitForPythonKernel(env: PythonEnvironment) {
        const kernelFinder = ServiceContainer.instance.get<IKernelFinder>(IKernelFinder);
        const finder = kernelFinder.registered.find(
            (item) => item.kind === ContributedKernelFinderKind.LocalPythonEnvironment
        ) as IContributedKernelFinder<PythonKernelConnectionMetadata>;
        if (!finder) {
            return;
        }
        return this.waitForPythonKernelFromFinder(env, finder);
    }
    private async waitForPythonKernelFromFinder(
        env: PythonEnvironment,
        finder: IContributedKernelFinder<PythonKernelConnectionMetadata>
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
                        if (this.cancelTokeSource.token.isCancellationRequested) {
                            return;
                        }
                        const kernel = finder.kernels.find((item) => item.interpreter.id === env.id);
                        if (kernel) {
                            dispose(disposables);
                            return resolve(kernel);
                        }
                        // Keep waiting, for ever, until another controller is selected for this notebook.
                    },
                    this,
                    this.disposables
                )
            );

            disposables.push(
                this.cancelTokeSource.token.onCancellationRequested(() => {
                    dispose(disposables);
                })
            );
        }).then((kernel) => {
            if (this.cancelTokeSource.token.isCancellationRequested) {
                return;
            }
            if (!kernel) {
                traceWarning(`New Python Environment ${getDisplayPath(env.uri)} not found as a kernel`);
            }
            return kernel;
        });
    }
    private async createPythonEnvironment(): Promise<{ interpreter?: PythonEnvironment; action?: 'Back' | 'Cancel' }> {
        const interpreterService = ServiceContainer.instance.get<IInterpreterService>(IInterpreterService);
        const cancellation = new CancellationTokenSource();
        try {
            const result: CreateEnvironmentResult = await commands.executeCommand('python.createEnvironment', {
                showBackButton: true,
                selectEnvironment: true
            });
            if (result?.action === 'Cancel') {
                return { action: 'Cancel' };
            }
            if (result?.action === 'Back') {
                return { action: 'Back' };
            }
            const path = result?.path;
            if (this.cancelTokeSource.token.isCancellationRequested) {
                return { action: 'Cancel' };
            }
            if (!path) {
                traceWarning(
                    `Python Environment not created, either user cancelled the creation or there was an error in the Python Extension`
                );
                return { action: 'Cancel' };
            }
            this.createdEnvId = path;
            traceVerbose(`Python Environment created ${path}`);
            const env = await interpreterService.getInterpreterDetails({ path });
            if (this.cancelTokeSource.token.isCancellationRequested) {
                return { action: 'Cancel' };
            }
            if (!env) {
                traceWarning(`No interpreter details for New Python Environment ${getDisplayPath(Uri.file(path))}`);
            }
            this.createdEnvId = env?.id;
            return { interpreter: env };
        } finally {
            cancellation.cancel();
            cancellation.dispose();
        }
    }
}
