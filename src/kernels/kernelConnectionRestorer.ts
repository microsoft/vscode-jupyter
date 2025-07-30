// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { CancellationToken, CancellationTokenSource, Uri, env } from 'vscode';
import { logger } from '../platform/logging';
import { IDisposable } from '../platform/common/types';
import {
    IKernelSession,
    KernelConnectionMetadata,
    LiveRemoteKernelConnectionMetadata,
    LocalKernelSpecConnectionMetadata,
    isLocalConnection
} from './types';
import { BaseKernelConnectionMetadata } from './types';
import { PersistedKernelState } from './kernelPersistenceService';
import { IKernelProcessDiscovery, KernelConnectionInfo } from './kernelProcessDiscovery.node';
import { IKernelSessionFactory } from './types';
import { IJupyterConnection } from './jupyter/types';
import { swallowExceptions } from '../platform/common/utils/misc';

export const IKernelConnectionRestorer = Symbol('IKernelConnectionRestorer');

export interface IKernelConnectionRestorer {
    /**
     * Attempt to restore a kernel connection from persisted state
     */
    restoreConnection(state: PersistedKernelState, token?: CancellationToken): Promise<IKernelSession | undefined>;

    /**
     * Validate that a kernel session connection is still active
     */
    validateConnection(session: IKernelSession): Promise<boolean>;

    /**
     * Check if a persisted kernel state can be restored
     */
    canRestore(state: PersistedKernelState): Promise<boolean>;
}

@injectable()
export class KernelConnectionRestorer implements IKernelConnectionRestorer {
    constructor(
        @inject(IKernelProcessDiscovery) private readonly processDiscovery: IKernelProcessDiscovery,
        @inject(IKernelSessionFactory) private readonly sessionFactory: IKernelSessionFactory
    ) {}

    async restoreConnection(
        state: PersistedKernelState,
        token?: CancellationToken
    ): Promise<IKernelSession | undefined> {
        try {
            logger.debug(`Attempting to restore connection for kernel ${state.kernelId} (${state.connectionKind})`);

            // Deserialize connection metadata
            const connectionMetadata = BaseKernelConnectionMetadata.fromJSON(state.connectionMetadata);

            // Choose restoration strategy based on connection type
            switch (state.connectionKind) {
                case 'startUsingLocalKernelSpec':
                case 'startUsingPythonInterpreter':
                    return await this.restoreLocalConnection(state, connectionMetadata, token);

                case 'connectToLiveRemoteKernel':
                case 'startUsingRemoteKernelSpec':
                    return await this.restoreRemoteConnection(state, connectionMetadata, token);

                default:
                    logger.warn(`Unsupported connection kind for restoration: ${state.connectionKind}`);
                    return undefined;
            }
        } catch (ex) {
            logger.error(`Failed to restore connection for kernel ${state.kernelId}`, ex);
            return undefined;
        }
    }

    async validateConnection(session: IKernelSession): Promise<boolean> {
        try {
            if (session.isDisposed || session.status === 'dead') {
                return false;
            }

            // Send a simple kernel_info request to validate the connection
            const future = session.kernel?.requestKernelInfo();
            if (!future) {
                return false;
            }

            // Wait for response with timeout
            return new Promise<boolean>((resolve) => {
                const timeout = setTimeout(() => resolve(false), 5000); // 5 second timeout

                future.done
                    .then(() => {
                        clearTimeout(timeout);
                        resolve(true);
                    })
                    .catch(() => {
                        clearTimeout(timeout);
                        resolve(false);
                    });
            });
        } catch {
            return false;
        }
    }

    async canRestore(state: PersistedKernelState): Promise<boolean> {
        try {
            // Check if we're in the same environment
            if (!this.isCurrentEnvironment(state)) {
                logger.debug(
                    `Kernel ${state.kernelId} is from different environment: ${
                        state.environmentType
                    } (current: ${this.getCurrentEnvironmentType()})`
                );
                return false;
            }

            switch (state.connectionKind) {
                case 'startUsingLocalKernelSpec':
                case 'startUsingPythonInterpreter':
                    // For local kernels, check if the process is still running
                    // Note: This only works for truly local environments, not remote ones
                    if (state.environmentType === 'local') {
                        return await this.processDiscovery.isKernelProcessRunning(state);
                    } else {
                        // Remote "local" kernels need different handling
                        logger.debug(`Cannot check process status for remote kernel ${state.kernelId}`);
                        return true; // Optimistically assume we can try
                    }

                case 'connectToLiveRemoteKernel':
                    // For remote kernels, we'll need to check if the session still exists
                    // This is a more complex check that would require querying the Jupyter server
                    return true; // Optimistically assume we can try

                case 'startUsingRemoteKernelSpec':
                    // For remote kernel specs, check if the server is accessible
                    return true; // Optimistically assume we can try

                default:
                    return false;
            }
        } catch (ex) {
            logger.debug(`Error checking if kernel ${state.kernelId} can be restored`, ex);
            return false;
        }
    }

    /**
     * Check if we're in the same environment as the persisted state
     */
    private isCurrentEnvironment(state: PersistedKernelState): boolean {
        const currentEnvType = this.getCurrentEnvironmentType();
        const currentRemoteName = env.remoteName || 'local';

        return state.environmentType === currentEnvType && (state.remoteName || 'local') === currentRemoteName;
    }

    /**
     * Determine current environment type
     */
    private getCurrentEnvironmentType(): 'local' | 'ssh' | 'container' | 'codespaces' | 'wsl' {
        if (!env.remoteName) {
            return 'local';
        }

        if (env.remoteName.startsWith('ssh-remote')) {
            return 'ssh';
        } else if (env.remoteName.startsWith('dev-container')) {
            return 'container';
        } else if (env.remoteName.startsWith('codespaces')) {
            return 'codespaces';
        } else if (env.remoteName.startsWith('wsl')) {
            return 'wsl';
        }

        return env.remoteName.includes('container') ? 'container' : 'ssh';
    }

    private async restoreLocalConnection(
        state: PersistedKernelState,
        connectionMetadata: KernelConnectionMetadata,
        token?: CancellationToken
    ): Promise<IKernelSession | undefined> {
        try {
            // Check if the kernel process is still running
            const isRunning = await this.processDiscovery.isKernelProcessRunning(state);
            if (!isRunning) {
                logger.debug(`Local kernel process ${state.processId} is no longer running`);
                return undefined;
            }

            // Get connection information for the running process
            const connectionInfo = state.processId
                ? await this.processDiscovery.getKernelConnectionInfo(state.processId)
                : undefined;

            if (!connectionInfo) {
                logger.debug(`Could not get connection info for kernel process ${state.processId}`);
                return undefined;
            }

            // Create a new kernel session using the existing connection
            return await this.createSessionFromConnectionInfo(connectionMetadata, connectionInfo, state, token);
        } catch (ex) {
            logger.error(`Failed to restore local connection for kernel ${state.kernelId}`, ex);
            return undefined;
        }
    }

    private async restoreRemoteConnection(
        state: PersistedKernelState,
        connectionMetadata: KernelConnectionMetadata,
        token?: CancellationToken
    ): Promise<IKernelSession | undefined> {
        try {
            logger.debug(`Restoring remote connection for kernel ${state.kernelId}`);

            // For remote connections, we need to check if the session still exists
            // and create a new session object that connects to the existing session

            if (connectionMetadata.kind === 'connectToLiveRemoteKernel') {
                const liveMetadata = connectionMetadata as LiveRemoteKernelConnectionMetadata;

                // Try to reconnect to the existing session
                return await this.reconnectToLiveRemoteKernel(liveMetadata, state, token);
            } else {
                // For remote kernel specs, we might need to start a new session
                // This is more complex and depends on whether the original session is still active
                logger.debug(`Remote kernel spec reconnection not yet implemented for ${state.kernelId}`);
                return undefined;
            }
        } catch (ex) {
            logger.error(`Failed to restore remote connection for kernel ${state.kernelId}`, ex);
            return undefined;
        }
    }

    private async createSessionFromConnectionInfo(
        connectionMetadata: KernelConnectionMetadata,
        connectionInfo: KernelConnectionInfo,
        state: PersistedKernelState,
        token?: CancellationToken
    ): Promise<IKernelSession | undefined> {
        try {
            logger.debug(`Creating session from connection info for kernel ${state.kernelId}`);

            // Create session with reconnection information
            const session = await this.sessionFactory.create({
                resource: Uri.parse(state.resourceUri),
                kernelConnection: connectionMetadata,
                token: token || new CancellationTokenSource().token,
                creator: 'jupyterExtension',
                ui: { disableUI: false },
                reconnectionInfo: {
                    sessionId: state.sessionId,
                    kernelId: state.kernelId,
                    connectionFile: connectionInfo.connectionFile,
                    workingDirectory: state.workingDirectory,
                    executionCount: state.executionCount
                }
            });

            // Validate the restored connection works
            if (session && (await this.validateConnectionWithTimeout(session, 10000))) {
                logger.info(`Successfully restored local kernel session ${state.kernelId}`);

                // Restore working directory if specified
                if (state.workingDirectory && session.changeDirectory) {
                    try {
                        await session.changeDirectory(state.workingDirectory);
                        logger.debug(`Restored working directory to ${state.workingDirectory}`);
                    } catch (ex) {
                        logger.debug(`Failed to restore working directory: ${ex}`);
                        // Non-critical failure, continue with reconnection
                    }
                }

                return session;
            } else {
                logger.warn(`Failed to validate restored connection for kernel ${state.kernelId}`);
                await swallowExceptions(() => session?.dispose());
                return undefined;
            }
        } catch (ex) {
            logger.error(`Failed to create session from connection info for kernel ${state.kernelId}`, ex);
            return undefined;
        }
    }

    /**
     * Validate connection with timeout
     */
    private async validateConnectionWithTimeout(session: IKernelSession, timeoutMs: number): Promise<boolean> {
        try {
            return await new Promise<boolean>((resolve) => {
                const timeout = setTimeout(() => resolve(false), timeoutMs);

                this.validateConnection(session)
                    .then((isValid) => {
                        clearTimeout(timeout);
                        resolve(isValid);
                    })
                    .catch(() => {
                        clearTimeout(timeout);
                        resolve(false);
                    });
            });
        } catch {
            return false;
        }
    }

    private async reconnectToLiveRemoteKernel(
        metadata: LiveRemoteKernelConnectionMetadata,
        state: PersistedKernelState,
        token?: CancellationToken
    ): Promise<IKernelSession | undefined> {
        try {
            logger.debug(`Reconnecting to live remote kernel ${state.kernelId}`);

            // Check if the remote session still exists
            const sessionExists = await this.checkRemoteSessionExists(
                metadata.baseUrl,
                state.sessionId,
                metadata.serverProviderHandle
            );

            if (!sessionExists) {
                logger.debug(`Remote session ${state.sessionId} no longer exists`);
                return undefined;
            }

            // Create session with reconnection information
            const session = await this.sessionFactory.create({
                resource: Uri.parse(state.resourceUri),
                kernelConnection: metadata,
                token: token || new CancellationTokenSource().token,
                creator: 'jupyterExtension',
                ui: { disableUI: false },
                reconnectionInfo: {
                    sessionId: state.sessionId,
                    kernelId: state.kernelId,
                    workingDirectory: state.workingDirectory,
                    executionCount: state.executionCount
                }
            });

            // Validate the remote connection
            if (session && (await this.validateConnectionWithTimeout(session, 15000))) {
                logger.info(`Successfully reconnected to remote kernel ${state.kernelId}`);
                return session;
            } else {
                logger.warn(`Failed to validate remote connection for kernel ${state.kernelId}`);
                await swallowExceptions(() => session?.dispose());
                return undefined;
            }
        } catch (ex) {
            logger.error(`Failed to reconnect to live remote kernel ${state.kernelId}`, ex);
            return undefined;
        }
    }

    /**
     * Check if a remote session still exists on the Jupyter server
     */
    private async checkRemoteSessionExists(
        baseUrl: string,
        sessionId: string,
        serverProviderHandle: any
    ): Promise<boolean> {
        try {
            // This would integrate with existing Jupyter server connection logic
            // For now, optimistically return true - the actual validation will happen
            // during session creation and connection validation

            logger.debug(`Checking if remote session ${sessionId} exists on ${baseUrl}`);

            // TODO: Implement actual Jupyter API call to check session existence
            // This would involve:
            // 1. Getting server connection from provider handle
            // 2. Calling GET /api/sessions/{sessionId}
            // 3. Handling authentication and network errors

            return true; // Optimistic assumption for now
        } catch (ex) {
            logger.debug(`Error checking remote session existence: ${ex}`);
            return false;
        }
    }
}
