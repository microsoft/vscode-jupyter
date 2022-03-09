// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import * as fsextra from 'fs-extra';
import { inject, injectable } from 'inversify';
import * as os from 'os';
import * as path from 'path';
import * as portfinder from 'portfinder';
import { promisify } from 'util';
import * as uuid from 'uuid/v4';
import { CancellationToken, window } from 'vscode';
import { IPythonExtensionChecker } from '../../api/types';
import { isTestExecution } from '../../common/constants';
import { traceInfo, traceWarning } from '../../common/logger';
import { IFileSystem } from '../../common/platform/types';
import { IProcessServiceFactory, IPythonExecutionFactory } from '../../common/process/types';
import { IConfigurationService, IDisposableRegistry, Resource } from '../../common/types';
import { Telemetry } from '../constants';
import {
    isLocalConnection,
    LocalKernelSpecConnectionMetadata,
    PythonKernelConnectionMetadata
} from '../jupyter/kernels/types';
import { KernelEnvironmentVariablesService } from './kernelEnvVarsService';
import { KernelProcess } from './kernelProcess';
import { IKernelConnection, IKernelLauncher, IKernelProcess } from './types';
import { CancellationError, createPromiseFromCancellation } from '../../common/cancellation';
import { sendKernelTelemetryWhenDone } from '../telemetry/telemetry';
import { sendTelemetryEvent } from '../../telemetry';
import { getTelemetrySafeErrorMessageFromPythonTraceback } from '../../common/errors/errorUtils';
import { getDisplayPath } from '../../common/platform/fs-paths';
import { swallowExceptions } from '../../common/utils/decorators';
import * as localize from '../../common/utils/localize';

const PortFormatString = `kernelLauncherPortStart_{0}.tmp`;
// Launches and returns a kernel process given a resource or python interpreter.
// If the given interpreter is undefined, it will try to use the selected interpreter.
// If the selected interpreter doesn't have a kernel, it will find a kernel on disk and use that.
@injectable()
export class KernelLauncher implements IKernelLauncher {
    private static startPortPromise = KernelLauncher.computeStartPort();
    private static _usedPorts = new Set<number>();
    private static getPorts = promisify(portfinder.getPorts);
    private portChain: Promise<number[]> | undefined;
    public static get usedPorts(): number[] {
        return Array.from(KernelLauncher._usedPorts);
    }
    constructor(
        @inject(IProcessServiceFactory) private processExecutionFactory: IProcessServiceFactory,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(KernelEnvironmentVariablesService)
        private readonly kernelEnvVarsService: KernelEnvironmentVariablesService,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IPythonExecutionFactory) private readonly pythonExecFactory: IPythonExecutionFactory,
        @inject(IConfigurationService) private readonly configService: IConfigurationService
    ) {}

    public static async cleanupStartPort() {
        try {
            // Destroy the file
            const port = await KernelLauncher.startPortPromise;
            traceInfo(`Cleaning up port start file : ${port}`);

            const filePath = path.join(os.tmpdir(), PortFormatString.format(port.toString()));
            await fsextra.remove(filePath);
        } catch (exc) {
            // If it fails it doesn't really matter. Just a temp file
            traceInfo(`Kernel port mutex failed to cleanup: `, exc);
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
            traceInfo(`Computed port start for KernelLauncher is : ${result}`);

            return result;
        } else {
            return 9_000;
        }
    }

    public async launch(
        kernelConnectionMetadata: LocalKernelSpecConnectionMetadata | PythonKernelConnectionMetadata,
        timeout: number,
        resource: Resource,
        workingDirectory: string,
        cancelToken: CancellationToken
    ): Promise<IKernelProcess> {
        const promise = (async () => {
            void this.logIPyKernelPath(resource, kernelConnectionMetadata);

            // Should be available now, wait with a timeout
            return await this.launchProcess(kernelConnectionMetadata, resource, workingDirectory, timeout, cancelToken);
        })();
        sendKernelTelemetryWhenDone(resource, Telemetry.KernelLauncherPerf, promise);
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
        kernelConnectionMetadata: LocalKernelSpecConnectionMetadata | PythonKernelConnectionMetadata
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
            {}
        );
        const displayInterpreterPath = getDisplayPath(interpreter.path);
        if (output.stdout) {
            const outputs = output.stdout
                .trim()
                .split('5dc3a68c-e34e-4080-9c3e-2a532b2ccb4d')
                .map((s) => s.trim())
                .filter((s) => s.length > 0);
            if (outputs.length === 2) {
                traceInfo(`ipykernel version ${outputs[0]} for ${displayInterpreterPath}`);
                traceInfo(`ipykernel location ${getDisplayPath(outputs[1])} for ${displayInterpreterPath}`);
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
            ? window.createOutputChannel(localize.DataScience.kernelConsoleOutputChannel().format(baseName))
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
            jupyterSettings
        );

        try {
            await Promise.race([
                kernelProcess.launch(workingDirectory, timeout, cancelToken),
                createPromiseFromCancellation({ token: cancelToken, cancelAction: 'reject' })
            ]);
        } catch (ex) {
            void kernelProcess.dispose();
            if (ex instanceof CancellationError || cancelToken?.isCancellationRequested) {
                throw new CancellationError();
            }
            throw ex;
        }

        const disposable = kernelProcess.exited(
            ({ exitCode, reason }) => {
                sendTelemetryEvent(Telemetry.RawKernelSessionKernelProcessExited, undefined, {
                    exitCode,
                    exitReason: getTelemetrySafeErrorMessageFromPythonTraceback(reason)
                });
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
        const ports = await KernelLauncher.getPorts(5, { host: '127.0.0.1', port });
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
        const ports = await KernelLauncher.findNextFreePort(startPort);
        traceInfo(`Kernel launching with ports ${ports.toString()}. Start port is ${startPort}`);

        return ports;
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
