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
import { Resource } from '../../common/types';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { Telemetry } from '../constants';
import { KernelSpecConnectionMetadata, PythonKernelConnectionMetadata } from '../jupyter/kernels/types';
import { IKernelDependencyService, KernelInterpreterDependencyResponse } from '../types';
import { KernelDaemonPool } from './kernelDaemonPool';
import { KernelEnvironmentVariablesService } from './kernelEnvVarsService';
import { KernelProcess } from './kernelProcess';
import { IKernelConnection, IKernelLauncher, IKernelProcess, IpyKernelNotInstalledError } from './types';
import * as localize from '../../common/utils/localize';
import { createDeferredFromPromise, Deferred } from '../../common/utils/async';
import { CancellationError } from '../../common/cancellation';
import { sendKernelTelemetryWhenDone } from '../telemetry/telemetry';

const PortFormatString = `kernelLauncherPortStart_{0}.tmp`;

// Launches and returns a kernel process given a resource or python interpreter.
// If the given interpreter is undefined, it will try to use the selected interpreter.
// If the selected interpreter doesn't have a kernel, it will find a kernel on disk and use that.
@injectable()
export class KernelLauncher implements IKernelLauncher {
    private static startPortPromise = KernelLauncher.computeStartPort();
    private static usedPorts = new Set<number>();
    private static getPorts = promisify(portfinder.getPorts);
    private dependencyPromises = new Map<string, Deferred<KernelInterpreterDependencyResponse>>();
    private portChain: Promise<number[]> | undefined;
    constructor(
        @inject(IProcessServiceFactory) private processExecutionFactory: IProcessServiceFactory,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(KernelDaemonPool) private readonly daemonPool: KernelDaemonPool,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(KernelEnvironmentVariablesService)
        private readonly kernelEnvVarsService: KernelEnvironmentVariablesService,
        @inject(IKernelDependencyService) private readonly kernelDependencyService: IKernelDependencyService
    ) {}

    // This function is public so it can be called when a test shuts down
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
                await this.installDependenciesIntoInterpreter(
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
        if (ports.some((item) => KernelLauncher.usedPorts.has(item))) {
            const maxPort = Math.max(...KernelLauncher.usedPorts, ...ports);
            return KernelLauncher.findNextFreePort(maxPort);
        }
        ports.forEach((item) => KernelLauncher.usedPorts.add(item));
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

    // If we need to install our dependencies now
    // then install ipykernel into the interpreter or throw error
    private async installDependenciesIntoInterpreter(
        interpreter: PythonEnvironment,
        cancelToken?: CancellationToken,
        disableUI?: boolean
    ) {
        // Cache the install question so when two kernels start at the same time for the same interpreter we don't ask twice
        let deferred = this.dependencyPromises.get(interpreter.path);
        if (!deferred) {
            deferred = createDeferredFromPromise(
                this.kernelDependencyService.installMissingDependencies(interpreter, cancelToken, disableUI)
            );
            this.dependencyPromises.set(interpreter.path, deferred);
        }

        // Get the result of the question
        try {
            const result = await deferred.promise;
            if (result !== KernelInterpreterDependencyResponse.ok) {
                throw new IpyKernelNotInstalledError(
                    localize.DataScience.ipykernelNotInstalled().format(
                        `${interpreter.displayName || interpreter.path}:${interpreter.path}`
                    ),
                    result
                );
            }
        } finally {
            // Don't need to cache anymore
            this.dependencyPromises.delete(interpreter.path);
        }
    }
}
