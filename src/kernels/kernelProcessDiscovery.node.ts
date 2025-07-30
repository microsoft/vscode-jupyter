// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Uri } from 'vscode';
import * as fs from 'fs-extra';
import * as path from '../platform/vscode-path/path';
import { logger } from '../platform/logging';
import { IProcessServiceFactory, IPythonExecutionFactory } from '../platform/common/process/types.node';
import { IFileSystem } from '../platform/common/platform/types';
import { IDisposable } from '../platform/common/types';
import { PersistedKernelState } from './kernelPersistenceService';
import { isLocalConnection, KernelConnectionMetadata } from './types';
import { BaseKernelConnectionMetadata } from './types';

export const IKernelProcessDiscovery = Symbol('IKernelProcessDiscovery');

export interface RunningKernelProcess {
    /**
     * Process ID of the kernel
     */
    pid: number;
    /**
     * Path to the kernel connection file
     */
    connectionFile: string;
    /**
     * Process start time
     */
    startTime: number;
    /**
     * Kernel ID if available from connection file
     */
    kernelId?: string;
    /**
     * Command line arguments used to start the kernel
     */
    cmdline?: string[];
}

export interface IKernelProcessDiscovery {
    /**
     * Find running kernel processes on the local system
     */
    findRunningKernelProcesses(): Promise<RunningKernelProcess[]>;

    /**
     * Check if a persisted kernel process is still running
     */
    isKernelProcessRunning(state: PersistedKernelState): Promise<boolean>;

    /**
     * Get connection information for a running kernel process
     */
    getKernelConnectionInfo(processId: number): Promise<KernelConnectionInfo | undefined>;
}

export interface KernelConnectionInfo {
    connectionFile: string;
    ports: {
        shell_port: number;
        iopub_port: number;
        stdin_port: number;
        control_port: number;
        hb_port: number;
    };
    key: string;
    ip: string;
    transport: string;
    signature_scheme: string;
}

@injectable()
export class KernelProcessDiscovery implements IKernelProcessDiscovery {
    constructor(
        @inject(IProcessServiceFactory) private readonly processServiceFactory: IProcessServiceFactory,
        @inject(IFileSystem) private readonly fileSystem: IFileSystem
    ) {}

    async findRunningKernelProcesses(): Promise<RunningKernelProcess[]> {
        try {
            const processes: RunningKernelProcess[] = [];

            // On Unix systems, look for jupyter kernel processes
            if (process.platform !== 'win32') {
                const unixProcesses = await this.findUnixKernelProcesses();
                processes.push(...unixProcesses);
            } else {
                const windowsProcesses = await this.findWindowsKernelProcesses();
                processes.push(...windowsProcesses);
            }

            // Also check for kernel connection files in runtime directories
            const runtimeDirProcesses = await this.findKernelsFromRuntimeDir();
            processes.push(...runtimeDirProcesses);

            logger.debug(`Found ${processes.length} running kernel processes`);
            return processes;
        } catch (ex) {
            logger.error('Failed to find running kernel processes', ex);
            return [];
        }
    }

    async isKernelProcessRunning(state: PersistedKernelState): Promise<boolean> {
        try {
            if (!state.processId) {
                return false;
            }

            // Check if process is still running
            const processService = await this.processServiceFactory.create();
            try {
                // On Unix systems, send signal 0 to check if process exists
                if (process.platform !== 'win32') {
                    process.kill(state.processId, 0);
                    return true;
                } else {
                    // On Windows, use tasklist to check if process exists
                    const result = await processService.exec('tasklist', ['/FI', `PID eq ${state.processId}`]);
                    return result.stdout.includes(state.processId.toString());
                }
            } catch {
                return false;
            }
        } catch (ex) {
            logger.debug(`Error checking if kernel process ${state.processId} is running`, ex);
            return false;
        }
    }

    async getKernelConnectionInfo(processId: number): Promise<KernelConnectionInfo | undefined> {
        try {
            // Try to find the connection file for this process
            const runningProcesses = await this.findRunningKernelProcesses();
            const targetProcess = runningProcesses.find((p) => p.pid === processId);

            if (!targetProcess?.connectionFile) {
                return undefined;
            }

            // Read and parse the connection file
            if (await this.fileSystem.exists(Uri.file(targetProcess.connectionFile))) {
                const connectionData = await this.fileSystem.readFile(Uri.file(targetProcess.connectionFile));
                const connectionInfo = JSON.parse(connectionData.toString()) as KernelConnectionInfo;
                connectionInfo.connectionFile = targetProcess.connectionFile;
                return connectionInfo;
            }
        } catch (ex) {
            logger.debug(`Failed to get connection info for process ${processId}`, ex);
        }

        return undefined;
    }

    private async findUnixKernelProcesses(): Promise<RunningKernelProcess[]> {
        try {
            const processService = await this.processServiceFactory.create();

            // Look for python processes with kernel in command line
            const result = await processService.exec('ps', ['aux']);
            const lines = result.stdout.split('\n');
            const processes: RunningKernelProcess[] = [];

            for (const line of lines) {
                if (line.includes('kernel') && (line.includes('python') || line.includes('ipython'))) {
                    const parts = line.trim().split(/\s+/);
                    if (parts.length < 11) continue;

                    const pid = parseInt(parts[1], 10);
                    if (isNaN(pid)) continue;

                    // Extract connection file from command line args
                    const cmdline = parts.slice(10).join(' ');
                    const connectionFileMatch = cmdline.match(/--f[=\s]+([^\s]+)/);

                    if (connectionFileMatch) {
                        processes.push({
                            pid,
                            connectionFile: connectionFileMatch[1],
                            startTime: Date.now(), // Placeholder - could get actual start time
                            cmdline: parts.slice(10)
                        });
                    }
                }
            }

            return processes;
        } catch (ex) {
            logger.debug('Failed to find Unix kernel processes', ex);
            return [];
        }
    }

    private async findWindowsKernelProcesses(): Promise<RunningKernelProcess[]> {
        try {
            const processService = await this.processServiceFactory.create();

            // Use wmic to get detailed process information
            const result = await processService.exec('wmic', [
                'process',
                'where',
                'name="python.exe" or name="pythonw.exe"',
                'get',
                'ProcessId,CommandLine,CreationDate',
                '/format:csv'
            ]);

            const lines = result.stdout.split('\n').slice(1); // Skip header
            const processes: RunningKernelProcess[] = [];

            for (const line of lines) {
                const parts = line.split(',');
                if (parts.length < 3) continue;

                const cmdline = parts[1];
                const pid = parseInt(parts[2], 10);

                if (isNaN(pid) || !cmdline.includes('kernel')) continue;

                // Extract connection file from command line
                const connectionFileMatch = cmdline.match(/--f[=\s]+"?([^"^\s]+)"?/);

                if (connectionFileMatch) {
                    processes.push({
                        pid,
                        connectionFile: connectionFileMatch[1],
                        startTime: Date.now(), // Could parse CreationDate for actual time
                        cmdline: cmdline.split(' ')
                    });
                }
            }

            return processes;
        } catch (ex) {
            logger.debug('Failed to find Windows kernel processes', ex);
            return [];
        }
    }

    private async findKernelsFromRuntimeDir(): Promise<RunningKernelProcess[]> {
        try {
            const processes: RunningKernelProcess[] = [];

            // Check Jupyter runtime directories for connection files
            const runtimeDirs = await this.getJupyterRuntimeDirs();

            for (const runtimeDir of runtimeDirs) {
                if (await this.fileSystem.exists(Uri.file(runtimeDir))) {
                    const files = await this.fileSystem.readDirectory(Uri.file(runtimeDir));

                    for (const [fileName, fileType] of files) {
                        if (fileType === 1 && fileName.startsWith('kernel-') && fileName.endsWith('.json')) {
                            const connectionFile = path.join(runtimeDir, fileName);

                            try {
                                // Try to extract PID from filename (common pattern: kernel-{pid}.json)
                                const pidMatch = fileName.match(/kernel-(\d+)\.json/);
                                if (pidMatch) {
                                    const pid = parseInt(pidMatch[1], 10);

                                    // Check if this process is still running
                                    if (await this.isProcessRunning(pid)) {
                                        processes.push({
                                            pid,
                                            connectionFile,
                                            startTime: Date.now() // Could get file creation time
                                        });
                                    }
                                }
                            } catch (ex) {
                                logger.debug(`Error processing connection file ${connectionFile}`, ex);
                            }
                        }
                    }
                }
            }

            return processes;
        } catch (ex) {
            logger.debug('Failed to find kernels from runtime directory', ex);
            return [];
        }
    }

    private async getJupyterRuntimeDirs(): Promise<string[]> {
        const dirs: string[] = [];

        // Common Jupyter runtime directories
        const homeDir = process.env.HOME || process.env.USERPROFILE;
        if (homeDir) {
            dirs.push(
                path.join(homeDir, '.local', 'share', 'jupyter', 'runtime'),
                path.join(homeDir, 'Library', 'Jupyter', 'runtime'), // macOS
                path.join(homeDir, 'AppData', 'Roaming', 'jupyter', 'runtime') // Windows
            );
        }

        // Environment variable override
        if (process.env.JUPYTER_RUNTIME_DIR) {
            dirs.push(process.env.JUPYTER_RUNTIME_DIR);
        }

        return dirs;
    }

    private async isProcessRunning(pid: number): Promise<boolean> {
        try {
            if (process.platform !== 'win32') {
                process.kill(pid, 0);
                return true;
            } else {
                const processService = await this.processServiceFactory.create();
                const result = await processService.exec('tasklist', ['/FI', `PID eq ${pid}`]);
                return result.stdout.includes(pid.toString());
            }
        } catch {
            return false;
        }
    }
}
