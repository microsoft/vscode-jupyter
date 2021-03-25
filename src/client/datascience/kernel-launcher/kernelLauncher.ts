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
import { CancellationToken } from 'vscode';
import { IPythonExtensionChecker } from '../../api/types';
import { isTestExecution } from '../../common/constants';
import { traceInfo } from '../../common/logger';
import { IFileSystem } from '../../common/platform/types';
import { IProcessServiceFactory } from '../../common/process/types';
import { IDisposableRegistry, Resource } from '../../common/types';
import { Telemetry } from '../constants';
import { KernelSpecConnectionMetadata, PythonKernelConnectionMetadata } from '../jupyter/kernels/types';
import { IKernelDependencyService } from '../types';
import { KernelDaemonPool } from './kernelDaemonPool';
import { KernelEnvironmentVariablesService } from './kernelEnvVarsService';
import { KernelProcess } from './kernelProcess';
import { IKernelConnection, IKernelLauncher, IKernelProcess } from './types';
import { CancellationError } from '../../common/cancellation';
import { sendKernelTelemetryWhenDone } from '../telemetry/telemetry';

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
        @inject(KernelDaemonPool) private readonly daemonPool: KernelDaemonPool,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(KernelEnvironmentVariablesService)
        private readonly kernelEnvVarsService: KernelEnvironmentVariablesService,
        @inject(IKernelDependencyService) private readonly kernelDependencyService: IKernelDependencyService,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry
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
        kernelConnectionMetadata: KernelSpecConnectionMetadata | PythonKernelConnectionMetadata,
        timeout: number,
        resource: Resource,
        workingDirectory: string,
        cancelToken?: CancellationToken,
        disableUI?: boolean
    ): Promise<IKernelProcess> {
        const promise = (async () => {
            // If this is a python interpreter, make sure it has ipykernel
            if (kernelConnectionMetadata.interpreter) {
                await this.kernelDependencyService.installMissingDependencies(
                    kernelConnectionMetadata.interpreter,
                    cancelToken,
                    disableUI
                );
            }

            // Should be available now, wait with a timeout
            return await this.launchProcess(kernelConnectionMetadata, resource, workingDirectory, timeout, cancelToken);
        })();
        sendKernelTelemetryWhenDone(resource, Telemetry.KernelLauncherPerf, promise);
        return promise;
    }

    private async launchProcess(
        kernelConnectionMetadata: KernelSpecConnectionMetadata | PythonKernelConnectionMetadata,
        resource: Resource,
        workingDirectory: string,
        timeout: number,
        cancelToken?: CancellationToken
    ): Promise<IKernelProcess> {
        const connection = await this.getKernelConnection(kernelConnectionMetadata);
        const kernelProcess = new KernelProcess(
            this.processExecutionFactory,
            this.daemonPool,
            connection,
            kernelConnectionMetadata,
            this.fs,
            resource,
            this.extensionChecker,
            this.kernelEnvVarsService
        );
        await kernelProcess.launch(workingDirectory, timeout, cancelToken);

        kernelProcess.exited(
            () => {
                KernelLauncher._usedPorts.delete(connection.control_port);
                KernelLauncher._usedPorts.delete(connection.hb_port);
                KernelLauncher._usedPorts.delete(connection.iopub_port);
                KernelLauncher._usedPorts.delete(connection.shell_port);
                KernelLauncher._usedPorts.delete(connection.stdin_port);
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
        kernelConnectionMetadata: KernelSpecConnectionMetadata | PythonKernelConnectionMetadata
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
