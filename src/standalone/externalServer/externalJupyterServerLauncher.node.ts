// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { CancellationToken, CancellationTokenSource, window } from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import { logger } from '../../platform/logging';
import { IDisposableRegistry, IConfigurationService } from '../../platform/common/types';
import { DataScience } from '../../platform/common/utils/localize';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import { UserJupyterServerUrlProvider } from '../userJupyterServer/userServerUrlProvider';
import { DisposableBase } from '../../platform/common/utils/lifecycle';
import { generateUuid } from '../../platform/common/uuid';
import { getRootFolder } from '../../platform/common/application/workspace.base';

/**
 * External server launch configuration
 */
export interface IExternalServerConfig {
    /** Display name for the server */
    name?: string;
    /** Port to launch the server on (default: auto-assign) */
    port?: number;
    /** Working directory for the server (default: workspace root) */
    workingDirectory?: string;
    /** Additional command line arguments */
    args?: string[];
    /** Whether to open browser (default: false) */
    openBrowser?: boolean;
}

/**
 * Service to launch external Jupyter servers and auto-connect to them
 */
@injectable()
export class ExternalJupyterServerLauncher extends DisposableBase {
    private runningServers = new Map<string, { process: ChildProcess; url: string; token: string }>();

    constructor(
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IConfigurationService) _configService: IConfigurationService,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(UserJupyterServerUrlProvider) private readonly serverUrlProvider: UserJupyterServerUrlProvider
    ) {
        super();
        disposables.push(this);
    }

    /**
     * Launch a Jupyter Lab server externally and auto-connect to it
     */
    public async launchAndConnect(config: IExternalServerConfig = {}, token?: CancellationToken): Promise<string | undefined> {
        try {
            const serverId = generateUuid();
            
            // Get interpreter
            const interpreter = await this.interpreterService.getActiveInterpreter(undefined);
            if (!interpreter) {
                throw new Error('No Python interpreter found. Please select a Python interpreter first.');
            }

            // Configure server parameters
            const port = config.port || await this.findAvailablePort();
            const serverToken = generateUuid().replace(/-/g, ''); // Remove hyphens for cleaner token
            const workingDir = config.workingDirectory || this.getWorkspaceRoot();
            // const displayName = config.name || `External Jupyter Server (${port})`;

            // Build command arguments
            const args = [
                '-m', 'jupyter', 'lab',
                '--no-browser',
                '--port', port.toString(),
                '--ip', '127.0.0.1',
                '--ServerApp.token', serverToken,
                '--ServerApp.allow_origin', '*',
                '--ServerApp.disable_check_xsrf', 'True'
            ];

            // Add custom arguments
            if (config.args) {
                args.push(...config.args);
            }

            logger.info(`Launching external Jupyter server: ${interpreter.uri.fsPath} ${args.join(' ')}`);

            // Launch the server as a detached process so it survives VSCode shutdown
            const process = spawn(interpreter.uri.fsPath, args, {
                cwd: workingDir,
                stdio: ['ignore', 'pipe', 'pipe'],
                detached: true  // Make the process independent of the parent
            });
            
            // Unref the process so Node doesn't wait for it to exit
            process.unref();

            const serverUrl = `http://127.0.0.1:${port}/?token=${serverToken}`;
            
            // Log the PID for user reference
            logger.info(`Persistent Jupyter server launched with PID: ${process.pid}`);
            
            // Store the running server
            this.runningServers.set(serverId, {
                process,
                url: serverUrl,
                token: serverToken
            });

            // Handle process events
            process.on('error', (error) => {
                logger.error(`Failed to start Jupyter server: ${error.message}`);
                this.runningServers.delete(serverId);
                window.showErrorMessage(DataScience.failedToStartJupyter(error.message));
            });

            process.on('exit', (code, signal) => {
                logger.info(`Jupyter server process exited with code ${code}, signal ${signal}`);
                this.runningServers.delete(serverId);
                // Only show warning for unexpected exits, not when detached
                if (code !== 0 && code !== null && !process.killed) {
                    window.showWarningMessage(`Jupyter server exited with code ${code}`);
                }
            });

            // Capture stderr for error reporting
            let stderrData = '';
            process.stderr?.on('data', (data) => {
                stderrData += data.toString();
                logger.debug(`Jupyter server stderr: ${data.toString()}`);
            });

            // Wait for server to start by monitoring stdout
            const serverStarted = await this.waitForServerStart(process, serverUrl, token);
            
            if (!serverStarted) {
                process.kill();
                this.runningServers.delete(serverId);
                const errorMessage = stderrData || 'Server failed to start within timeout period';
                throw new Error(errorMessage);
            }

            // Auto-connect to the server via UserJupyterServerUrlProvider
            try {
                // Create a cancellation token if not provided
                const cancellationToken = token || new CancellationTokenSource().token;
                const handle = await this.serverUrlProvider.captureRemoteJupyterUrl(
                    cancellationToken, 
                    serverUrl
                );

                if (!handle || typeof handle !== 'string') {
                    throw new Error('Failed to register server with URL provider');
                }

                await window.showInformationMessage(
                    `Persistent Jupyter server started successfully at ${serverUrl} (PID: ${process.pid})`,
                    'Open in Browser'
                ).then((action) => {
                    if (action === 'Open in Browser') {
                        const vscode = require('vscode');
                        vscode.env.openExternal(vscode.Uri.parse(`http://127.0.0.1:${port}/lab`));
                    }
                });

                logger.info(`External Jupyter server launched and connected: ${serverUrl}`);
                return handle;

            } catch (connectError) {
                logger.error('Failed to auto-connect to launched server', connectError);
                // Don't kill the server, just show the URL for manual connection
                await window.showWarningMessage(
                    `Server launched successfully but auto-connect failed. You can manually connect to: ${serverUrl}`,
                    'Copy URL',
                    'Open in Browser'
                ).then((action) => {
                    if (action === 'Copy URL') {
                        const vscode = require('vscode');
                        vscode.env.clipboard.writeText(serverUrl);
                    } else if (action === 'Open in Browser') {
                        const vscode = require('vscode');
                        vscode.env.openExternal(vscode.Uri.parse(`http://127.0.0.1:${port}/lab`));
                    }
                });
                return undefined;
            }

        } catch (error) {
            logger.error('Failed to launch external Jupyter server', error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            await window.showErrorMessage(DataScience.failedToStartJupyter(errorMessage));
            return undefined;
        }
    }

    /**
     * Wait for the server to start by checking if it responds to requests
     */
    private async waitForServerStart(
        process: ChildProcess, 
        serverUrl: string, 
        token?: CancellationToken,
        timeoutMs: number = 30000
    ): Promise<boolean> {
        const startTime = Date.now();
        const checkInterval = 1000; // Check every second

        while (Date.now() - startTime < timeoutMs) {
            if (token?.isCancellationRequested) {
                return false;
            }

            if (!process.pid) {
                return false; // Process died
            }

            try {
                // Simple health check
                const response = await fetch(`${serverUrl.split('?')[0]}api`, {
                    method: 'GET',
                    signal: AbortSignal.timeout(2000)
                });
                
                if (response.ok) {
                    return true;
                }
            } catch (error) {
                // Server not ready yet, continue waiting
            }

            // Wait before next check
            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }

        return false;
    }

    /**
     * Find an available port starting from 8888
     */
    private async findAvailablePort(startPort: number = 8888): Promise<number> {
        
        for (let port = startPort; port < startPort + 100; port++) {
            if (await this.isPortAvailable(port)) {
                return port;
            }
        }
        
        throw new Error(`No available ports found starting from ${startPort}`);
    }

    private isPortAvailable(port: number): Promise<boolean> {
        return new Promise((resolve) => {
            const net = require('net');
            const server = net.createServer();
            
            server.listen(port, () => {
                server.close(() => resolve(true));
            });
            
            server.on('error', () => resolve(false));
        });
    }

    private getWorkspaceRoot(): string {
        const workspaceFolder = getRootFolder();
        return workspaceFolder?.fsPath || process.cwd();
    }

    /**
     * Stop all running external servers
     */
    public async stopAllServers(): Promise<void> {
        for (const serverId of this.runningServers.keys()) {
            const serverInfo = this.runningServers.get(serverId)!;
            try {
                logger.info(`Stopping external Jupyter server ${serverId}`);
                serverInfo.process.kill('SIGTERM');
                
                // Give process time to shutdown gracefully
                setTimeout(() => {
                    if (!serverInfo.process.killed) {
                        serverInfo.process.kill('SIGKILL');
                    }
                }, 5000);
                
            } catch (error) {
                logger.error(`Error stopping server ${serverId}:`, error);
            }
        }
        
        this.runningServers.clear();
    }

    public override dispose(): void {
        // Don't stop servers on dispose - they should persist
        // Users can manually stop them if needed
        // this.stopAllServers().catch(noop);
        super.dispose();
    }
}