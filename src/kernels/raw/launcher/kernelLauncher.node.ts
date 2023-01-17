// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import * as fsextra from 'fs-extra';
import { inject, injectable } from 'inversify';
import * as os from 'os';
import * as path from '../../../platform/vscode-path/path';
import { promisify } from 'util';
import uuid from 'uuid/v4';
import { CancellationError, CancellationToken, window } from 'vscode';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { Cancellation, createPromiseFromCancellation } from '../../../platform/common/cancellation';
import { getTelemetrySafeErrorMessageFromPythonTraceback } from '../../../platform/errors/errorUtils';
import { traceDecoratorVerbose, traceInfo, traceVerbose, traceWarning } from '../../../platform/logging';
import { getDisplayPath } from '../../../platform/common/platform/fs-paths';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import { IProcessServiceFactory, IPythonExecutionFactory } from '../../../platform/common/process/types.node';
import { IDisposableRegistry, IConfigurationService, Resource } from '../../../platform/common/types';
import { swallowExceptions } from '../../../platform/common/utils/decorators';
import { DataScience } from '../../../platform/common/utils/localize';
import { sendTelemetryEvent, Telemetry } from '../../../telemetry';
import {
    isLocalConnection,
    LocalKernelSpecConnectionMetadata,
    PythonKernelConnectionMetadata
} from '../../../kernels/types';
import { IKernelLauncher, IKernelProcess, IKernelConnection } from '../types';
import { KernelEnvironmentVariablesService } from './kernelEnvVarsService.node';
import { KernelProcess } from './kernelProcess.node';
import { JupyterPaths } from '../finder/jupyterPaths.node';
import { isTestExecution } from '../../../platform/common/constants';
import { getDisplayPathFromLocalFile } from '../../../platform/common/platform/fs-paths.node';
import { noop } from '../../../platform/common/utils/misc';
import { sendKernelTelemetryEvent } from '../../telemetry/sendKernelTelemetryEvent';
import { PythonKernelInterruptDaemon } from '../finder/pythonKernelInterruptDaemon.node';
import { IPlatformService } from '../../../platform/common/platform/types';
import { StopWatch } from '../../../platform/common/utils/stopWatch';
import { TraceOptions } from '../../../platform/logging/types';
import { getResourceType } from '../../../platform/common/utils';

const PortFormatString = `kernelLauncherPortStart_{0}.tmp`;
// Launches and returns a kernel process given a resource or python interpreter.
// If the given interpreter is undefined, it will try to use the selected interpreter.
// If the selected interpreter doesn't have a kernel, it will find a kernel on disk and use that.
@injectable()
export class KernelLauncher implements IKernelLauncher {
    private static startPortPromise = KernelLauncher.computeStartPort();
    private static _usedPorts = new Set<number>();
    private portChain: Promise<number[]> | undefined;
    public static get usedPorts(): number[] {
        return Array.from(KernelLauncher._usedPorts);
    }
    constructor(
        @inject(IProcessServiceFactory) private processExecutionFactory: IProcessServiceFactory,
        @inject(IFileSystemNode) private readonly fs: IFileSystemNode,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(KernelEnvironmentVariablesService)
        private readonly kernelEnvVarsService: KernelEnvironmentVariablesService,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IPythonExecutionFactory) private readonly pythonExecFactory: IPythonExecutionFactory,
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(JupyterPaths) private readonly jupyterPaths: JupyterPaths,
        @inject(PythonKernelInterruptDaemon) private readonly pythonKernelInterruptDaemon: PythonKernelInterruptDaemon,
        @inject(IPlatformService) private readonly platformService: IPlatformService
    ) {}

    public static async cleanupStartPort() {
        try {
            // Destroy the file
            const port = await KernelLauncher.startPortPromise;
            traceVerbose(`Cleaning up port start file : ${port}`);

            const filePath = path.join(os.tmpdir(), PortFormatString.format(port.toString()));
            await fsextra.remove(filePath);
        } catch (exc) {
            // If it fails it doesn't really matter. Just a temp file
            traceWarning(`Kernel port mutex failed to cleanup: `, exc);
        }
    }

    private static async computeStartPort(): Promise<number> {
        if (isTestExecution()) {
            // Since multiple instances of a test may be running, write our best guess to a shared file
            let portStart = 9_000;
            let result = 0;
            while (result === 0 && portStart < 65_000) {
                try {
                    // Try creating a file with the port in the name
                    const filePath = path.join(os.tmpdir(), PortFormatString.format(portStart.toString()));
                    await fsextra.open(filePath, 'wx');

                    // If that works, we have our port
                    result = portStart;
                } catch {
                    // If that fails, it should mean the file already exists
                    portStart += 1_000;
                }
            }
            traceVerbose(`Computed port start for KernelLauncher is : ${result}`);

            return result;
        } else {
            return 9_000;
        }
    }

    @traceDecoratorVerbose('Kernel Launcher. launch', TraceOptions.BeforeCall | TraceOptions.Arguments)
    public async launch(
        kernelConnectionMetadata: LocalKernelSpecConnectionMetadata | PythonKernelConnectionMetadata,
        timeout: number,
        resource: Resource,
        workingDirectory: string,
        cancelToken: CancellationToken
    ): Promise<IKernelProcess> {
        const stopWatch = new StopWatch();
        const promise = (async () => {
            this.logIPyKernelPath(resource, kernelConnectionMetadata, cancelToken).catch(noop);

            // Should be available now, wait with a timeout
            return await this.launchProcess(kernelConnectionMetadata, resource, workingDirectory, timeout, cancelToken);
        })();
        promise
            .then(() =>
                /* No need to send telemetry for kernel launch failures, that's sent elsewhere */
                sendTelemetryEvent(
                    Telemetry.KernelLauncherPerf,
                    { duration: stopWatch.elapsedTime },
                    { resourceType: getResourceType(resource) }
                )
            )
            .ignoreErrors();
        return promise;
    }

    /**
     * Sometimes users install this in user site_packages and things don't work as expected.
     * It should be installed into the specific python env.
     * Logging this information would be helpful in diagnosing issues.
     */
    @swallowExceptions('Failed to capture IPyKernel version and path')
    private async logIPyKernelPath(
        resource: Resource,
        kernelConnectionMetadata: LocalKernelSpecConnectionMetadata | PythonKernelConnectionMetadata,
        token: CancellationToken
    ) {
        const interpreter = kernelConnectionMetadata.interpreter;
        if (!isLocalConnection(kernelConnectionMetadata) || !interpreter) {
            return;
        }
        const service = await this.pythonExecFactory.createActivatedEnvironment({
            interpreter,
            resource
        });
        const output = await service.exec(
            [
                '-c',
                'import ipykernel; print(ipykernel.__version__); print("5dc3a68c-e34e-4080-9c3e-2a532b2ccb4d"); print(ipykernel.__file__)'
            ],
            { token }
        );
        if (token.isCancellationRequested) {
            return;
        }
        const displayInterpreterPath = getDisplayPath(interpreter.uri);
        if (output.stdout) {
            const outputs = output.stdout
                .trim()
                .split('5dc3a68c-e34e-4080-9c3e-2a532b2ccb4d')
                .map((s) => s.trim())
                .filter((s) => s.length > 0);
            if (outputs.length === 2) {
                traceInfo(
                    `ipykernel version & path ${outputs[0]}, ${getDisplayPathFromLocalFile(
                        outputs[1]
                    )} for ${displayInterpreterPath}`
                );
            } else {
                traceInfo(`ipykernel version & path ${output.stdout.trim()} for ${displayInterpreterPath}`);
            }
        }
        if (output.stderr) {
            traceWarning(
                `Stderr output when getting ipykernel version & path ${output.stderr.trim()} for ${displayInterpreterPath}`
            );
        }
    }

    private async launchProcess(
        kernelConnectionMetadata: LocalKernelSpecConnectionMetadata | PythonKernelConnectionMetadata,
        resource: Resource,
        workingDirectory: string,
        timeout: number,
        cancelToken: CancellationToken
    ): Promise<IKernelProcess> {
        const connection = await Promise.race([
            this.getKernelConnection(kernelConnectionMetadata),
            createPromiseFromCancellation({ cancelAction: 'resolve', defaultValue: undefined, token: cancelToken })
        ]);
        if (!connection || cancelToken?.isCancellationRequested) {
            throw new CancellationError();
        }

        // Create a new output channel for this kernel
        const baseName = resource ? path.basename(resource.fsPath) : '';
        const jupyterSettings = this.configService.getSettings(resource);
        const outputChannel = jupyterSettings.logKernelOutputSeparately
            ? window.createOutputChannel(DataScience.kernelConsoleOutputChannel(baseName))
            : undefined;
        outputChannel?.clear();

        // Create the process
        const kernelProcess = new KernelProcess(
            this.processExecutionFactory,
            connection,
            kernelConnectionMetadata,
            this.fs,
            resource,
            this.extensionChecker,
            this.kernelEnvVarsService,
            this.pythonExecFactory,
            outputChannel,
            jupyterSettings,
            this.jupyterPaths,
            this.pythonKernelInterruptDaemon,
            this.platformService
        );

        try {
            await Promise.race([
                kernelProcess.launch(workingDirectory, timeout, cancelToken),
                createPromiseFromCancellation({ token: cancelToken, cancelAction: 'reject' })
            ]);
        } catch (ex) {
            await kernelProcess.dispose();
            Cancellation.throwIfCanceled(cancelToken);
            throw ex;
        }

        const disposable = kernelProcess.exited(
            ({ exitCode, reason }) => {
                sendKernelTelemetryEvent(
                    resource,
                    Telemetry.RawKernelSessionKernelProcessExited,
                    exitCode ? { exitCode } : undefined,
                    {
                        exitReason: getTelemetrySafeErrorMessageFromPythonTraceback(reason)
                    }
                );
                KernelLauncher._usedPorts.delete(connection.control_port);
                KernelLauncher._usedPorts.delete(connection.hb_port);
                KernelLauncher._usedPorts.delete(connection.iopub_port);
                KernelLauncher._usedPorts.delete(connection.shell_port);
                KernelLauncher._usedPorts.delete(connection.stdin_port);
                disposable.dispose();
            },
            this,
            this.disposables
        );

        // Double check for cancel
        if (cancelToken?.isCancellationRequested) {
            await kernelProcess.dispose();
            throw new CancellationError();
        }
        return kernelProcess;
    }

    private async chainGetConnectionPorts(): Promise<number[]> {
        if (this.portChain) {
            await this.portChain;
        }
        this.portChain = this.getConnectionPorts();
        return this.portChain;
    }

    static async findNextFreePort(port: number): Promise<number[]> {
        // Then get the next set starting at that point
        const getPorts = promisify((await import('portfinder')).getPorts);
        const ports = await getPorts(5, { host: '127.0.0.1', port });
        if (ports.some((item) => KernelLauncher._usedPorts.has(item))) {
            const maxPort = Math.max(...KernelLauncher._usedPorts, ...ports);
            return KernelLauncher.findNextFreePort(maxPort);
        }
        ports.forEach((item) => KernelLauncher._usedPorts.add(item));
        return ports;
    }

    private async getConnectionPorts(): Promise<number[]> {
        // Have to wait for static port lookup (it handles case where two VS code instances are running)
        const startPort = await KernelLauncher.startPortPromise;

        // Then get the next set starting at that point
        return KernelLauncher.findNextFreePort(startPort);
    }

    private async getKernelConnection(
        kernelConnectionMetadata: LocalKernelSpecConnectionMetadata | PythonKernelConnectionMetadata
    ): Promise<IKernelConnection> {
        const ports = await this.chainGetConnectionPorts();
        return {
            key: uuid(),
            signature_scheme: 'hmac-sha256',
            transport: 'tcp',
            ip: '127.0.0.1',
            hb_port: ports[0],
            control_port: ports[1],
            shell_port: ports[2],
            stdin_port: ports[3],
            iopub_port: ports[4],
            kernel_name: kernelConnectionMetadata.kernelSpec?.name || 'python'
        };
    }
}
