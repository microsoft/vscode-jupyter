// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fsextra from 'fs-extra';
import { inject, injectable } from 'inversify';
import * as os from 'os';
import * as path from '../../../platform/vscode-path/path';
import { promisify } from 'util';
import uuid from 'uuid/v4';
import { CancellationError, CancellationToken, window } from 'vscode';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { Cancellation, raceCancellationError } from '../../../platform/common/cancellation';
import { getTelemetrySafeErrorMessageFromPythonTraceback } from '../../../platform/errors/errorUtils';
import { traceVerbose, traceWarning } from '../../../platform/logging';
import { getDisplayPath } from '../../../platform/common/platform/fs-paths';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import { IProcessServiceFactory } from '../../../platform/common/process/types.node';
import { IDisposableRegistry, IConfigurationService, Resource } from '../../../platform/common/types';
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
import { getResourceType } from '../../../platform/common/utils';
import { format, splitLines } from '../../../platform/common/helpers';
import { IPythonExecutionFactory } from '../../../platform/interpreter/types.node';
import { UsedPorts, ignorePortForwarding } from '../../common/usedPorts';
import { isPythonKernelConnection } from '../../helpers';
import { once } from '../../../platform/common/utils/events';
import { getNotebookTelemetryTracker } from '../../telemetry/notebookTelemetry';

const PortFormatString = `kernelLauncherPortStart_{0}.tmp`;
// Launches and returns a kernel process given a resource or python interpreter.
// If the given interpreter is undefined, it will try to use the selected interpreter.
// If the selected interpreter doesn't have a kernel, it will find a kernel on disk and use that.
@injectable()
export class KernelLauncher implements IKernelLauncher {
    private static startPortPromise = KernelLauncher.computeStartPort();
    private portChain: Promise<number[]> | undefined;
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

    private static async computeStartPort(): Promise<number> {
        if (isTestExecution()) {
            // Since multiple instances of a test may be running, write our best guess to a shared file
            let portStart = 9_000;
            let result = 0;
            while (result === 0 && portStart < 65_000) {
                try {
                    // Try creating a file with the port in the name
                    const filePath = path.join(os.tmpdir(), format(PortFormatString, portStart.toString()));
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

    public async launch(
        kernelConnectionMetadata: LocalKernelSpecConnectionMetadata | PythonKernelConnectionMetadata,
        timeout: number,
        resource: Resource,
        workingDirectory: string,
        cancelToken: CancellationToken
    ): Promise<IKernelProcess> {
        logIPyKernelPath(resource, kernelConnectionMetadata, this.pythonExecFactory, cancelToken).catch(noop);
        const stopWatch = new StopWatch();
        const tracker = getNotebookTelemetryTracker(resource)?.getConnection();
        const connection = await raceCancellationError(cancelToken, this.getKernelConnection(kernelConnectionMetadata));
        tracker?.stop();
        // Create a new output channel for this kernel
        const baseName = resource ? path.basename(resource.fsPath) : '';
        const jupyterSettings = this.configService.getSettings(resource);
        const outputChannel =
            jupyterSettings.logKernelOutputSeparately || jupyterSettings.development
                ? window.createOutputChannel(DataScience.kernelConsoleOutputChannel(baseName), 'log')
                : undefined;
        outputChannel?.clear();
        const portAttributeProvider = ignorePortForwarding(
            connection.control_port,
            connection.hb_port,
            connection.iopub_port,
            connection.shell_port,
            connection.stdin_port
        );
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
        once(kernelProcess.onDidDispose)(() => portAttributeProvider.dispose(), this, this.disposables);
        once(kernelProcess.exited)(() => outputChannel?.dispose(), this, this.disposables);
        try {
            await raceCancellationError(cancelToken, kernelProcess.launch(workingDirectory, timeout, cancelToken));
        } catch (ex) {
            await kernelProcess.dispose();
            Cancellation.throwIfCanceled(cancelToken);
            throw ex;
        }

        const disposable = once(kernelProcess.exited)(
            ({ exitCode, reason }) => {
                sendKernelTelemetryEvent(
                    resource,
                    Telemetry.RawKernelSessionKernelProcessExited,
                    exitCode ? { exitCode } : undefined,
                    {
                        exitReason: getTelemetrySafeErrorMessageFromPythonTraceback(reason)
                    }
                );
                UsedPorts.delete(connection.control_port);
                UsedPorts.delete(connection.hb_port);
                UsedPorts.delete(connection.iopub_port);
                UsedPorts.delete(connection.shell_port);
                UsedPorts.delete(connection.stdin_port);
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
        /* No need to send telemetry for kernel launch failures, that's sent elsewhere */
        sendTelemetryEvent(
            Telemetry.KernelLauncherPerf,
            { duration: stopWatch.elapsedTime },
            { resourceType: getResourceType(resource) }
        );

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
        if (ports.some((item) => UsedPorts.has(item))) {
            const maxPort = Math.max(...UsedPorts, ...ports);
            return KernelLauncher.findNextFreePort(maxPort);
        }
        ports.forEach((item) => UsedPorts.add(item));
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

/**
 * Sometimes users install this in user site_packages and things don't work as expected.
 * It should be installed into the specific python env.
 * Logging this information would be helpful in diagnosing issues.
 */
async function logIPyKernelPath(
    resource: Resource,
    kernelConnectionMetadata: LocalKernelSpecConnectionMetadata | PythonKernelConnectionMetadata,
    pythonExecFactory: IPythonExecutionFactory,
    token: CancellationToken
) {
    const interpreter = kernelConnectionMetadata.interpreter;
    if (
        !isLocalConnection(kernelConnectionMetadata) ||
        !isPythonKernelConnection(kernelConnectionMetadata) ||
        !interpreter
    ) {
        return;
    }
    const service = await pythonExecFactory.createActivatedEnvironment({
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
            traceVerbose(
                `ipykernel version & path ${outputs[0]}, ${getDisplayPathFromLocalFile(
                    outputs[1]
                )} for ${displayInterpreterPath}`
            );
        } else {
            traceVerbose(`ipykernel version & path ${output.stdout.trim()} for ${displayInterpreterPath}`);
        }
    }
    if (output.stderr) {
        const formattedOutput = splitLines(output.stderr.trim(), { removeEmptyEntries: true, trim: true })
            .map((l, i) => (i === 0 ? l : `    ${l}`))
            .join('\n');
        traceWarning(
            `Stderr output when getting ipykernel version & path ${formattedOutput} for ${displayInterpreterPath}`
        );
    }
}
