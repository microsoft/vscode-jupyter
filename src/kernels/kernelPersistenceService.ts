// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Memento, workspace, env } from 'vscode';
import { IKernel, KernelConnectionMetadata, IKernelSession } from './types';
import { Resource, IDisposable } from '../platform/common/types';
import { logger } from '../platform/logging';
import { IDisposableRegistry, IApplicationEnvironment, IMemento, GLOBAL_MEMENTO } from '../platform/common/types';
import { noop } from '../platform/common/utils/misc';
import { dispose } from '../platform/common/utils/lifecycle';

export const IKernelPersistenceService = Symbol('IKernelPersistenceService');

export interface PersistedKernelState {
    /**
     * Unique identifier for the kernel instance
     */
    kernelId: string;
    /**
     * Jupyter session ID
     */
    sessionId: string;
    /**
     * Serialized connection metadata
     */
    connectionMetadata: Record<string, unknown>;
    /**
     * URI of the resource (notebook/file) using this kernel
     */
    resourceUri: string;
    /**
     * Process ID for local kernels (only meaningful in the same environment)
     */
    processId?: number;
    /**
     * Path to ZMQ connection file for local kernels
     */
    connectionFile?: string;
    /**
     * Working directory of the kernel
     */
    workingDirectory?: string;
    /**
     * Timestamp of last activity
     */
    lastActivity: number;
    /**
     * Last known execution count
     */
    executionCount?: number;
    /**
     * Connection type for quick filtering
     */
    connectionKind: string;
    /**
     * Remote environment context
     */
    remoteName?: string;
    /**
     * Remote host information
     */
    remoteHost?: string;
    /**
     * Environment type
     */
    environmentType: 'local' | 'ssh' | 'container' | 'codespaces' | 'wsl';
}

export interface IKernelPersistenceService extends IDisposable {
    /**
     * Save kernel state for future reconnection
     */
    saveKernelState(kernel: IKernel, resource: Resource): Promise<void>;

    /**
     * Load all persisted kernel states
     */
    loadPersistedKernelStates(): Promise<PersistedKernelState[]>;

    /**
     * Remove kernel state when cleanly shut down
     */
    removeKernelState(kernelId: string): Promise<void>;

    /**
     * Attempt reconnection to persisted kernels
     */
    reconnectToKernels(): Promise<ReconnectionResult[]>;

    /**
     * Clean up old/stale kernel states
     */
    cleanupStaleStates(): Promise<void>;
}

export interface ReconnectionResult {
    kernelId: string;
    resourceUri: string;
    success: boolean;
    error?: string;
    kernel?: IKernel;
}

@injectable()
export class KernelPersistenceService implements IKernelPersistenceService {
    private static readonly KERNEL_STATES_KEY_PREFIX = 'persistedKernelStates.v1';
    private static readonly MAX_PERSISTENCE_AGE_HOURS = 24; // Configurable via settings

    private readonly disposables: IDisposable[] = [];
    private persistedStates: Map<string, PersistedKernelState> = new Map();

    constructor(
        @inject(IMemento) @inject(GLOBAL_MEMENTO) private readonly globalMemento: Memento,
        @inject(IDisposableRegistry) private readonly disposableRegistry: IDisposableRegistry,
        @inject(IApplicationEnvironment) private readonly appEnv: IApplicationEnvironment
    ) {
        this.disposableRegistry.push(this);
        this.loadStatesFromMemento().catch((ex) => logger.error('Failed to load persisted kernel states', ex));
    }

    /**
     * Get environment-specific storage key
     */
    private getStorageKey(): string {
        const environmentType = this.getCurrentEnvironmentType();
        const remoteName = env.remoteName || 'local';
        const appHost = env.appHost || 'desktop';
        return `${KernelPersistenceService.KERNEL_STATES_KEY_PREFIX}.${environmentType}.${remoteName}.${appHost}`;
    }

    /**
     * Determine current environment type
     */
    private getCurrentEnvironmentType(): 'local' | 'ssh' | 'container' | 'codespaces' | 'wsl' {
        if (!env.remoteName) {
            return 'local';
        }

        // VSCode remote environment detection
        if (env.remoteName.startsWith('ssh-remote')) {
            return 'ssh';
        } else if (env.remoteName.startsWith('dev-container')) {
            return 'container';
        } else if (env.remoteName.startsWith('codespaces')) {
            return 'codespaces';
        } else if (env.remoteName.startsWith('wsl')) {
            return 'wsl';
        }

        // Default for unknown remote types
        return env.remoteName.includes('container') ? 'container' : 'ssh';
    }

    /**
     * Check if we're in the same environment as the persisted state
     */
    private isCurrentEnvironment(state: PersistedKernelState): boolean {
        const currentEnvType = this.getCurrentEnvironmentType();
        const currentRemoteName = env.remoteName || 'local';
        const currentAppHost = env.appHost || 'desktop';

        return (
            state.environmentType === currentEnvType &&
            (state.remoteName || 'local') === currentRemoteName &&
            // For additional safety, could also check remoteHost if available
            true
        );
    }

    async saveKernelState(kernel: IKernel, resource: Resource): Promise<void> {
        try {
            const connectionMetadata = kernel.kernelConnectionMetadata;
            if (!connectionMetadata) {
                logger.debug(`Cannot persist kernel ${kernel.id}: no connection metadata`);
                return;
            }

            const persistedState: PersistedKernelState = {
                kernelId: kernel.id,
                sessionId: kernel.session?.kernel?.id || '',
                connectionMetadata: connectionMetadata.toJSON(),
                resourceUri: resource.toString(),
                processId: this.extractProcessId(kernel),
                connectionFile: this.extractConnectionFile(kernel),
                workingDirectory: kernel.workingDirectory?.workingDirectory,
                lastActivity: Date.now(),
                executionCount: kernel.info?.execution_count,
                connectionKind: connectionMetadata.kind,
                // Add environment context
                remoteName: env.remoteName,
                remoteHost: env.appHost,
                environmentType: this.getCurrentEnvironmentType()
            };

            // Store in memory and persist to storage
            this.persistedStates.set(kernel.id, persistedState);
            await this.saveStatesToMemento();

            logger.debug(`Persisted kernel state for ${kernel.id} (${connectionMetadata.kind})`);
        } catch (ex) {
            logger.error(`Failed to persist kernel state for ${kernel.id}`, ex);
        }
    }

    async loadPersistedKernelStates(): Promise<PersistedKernelState[]> {
        await this.loadStatesFromMemento();
        return Array.from(this.persistedStates.values());
    }

    async removeKernelState(kernelId: string): Promise<void> {
        try {
            if (this.persistedStates.delete(kernelId)) {
                await this.saveStatesToMemento();
                logger.debug(`Removed persisted state for kernel ${kernelId}`);
            }
        } catch (ex) {
            logger.error(`Failed to remove kernel state for ${kernelId}`, ex);
        }
    }

    async reconnectToKernels(): Promise<ReconnectionResult[]> {
        const results: ReconnectionResult[] = [];
        const enableReconnection = this.getReconnectionSetting();

        if (!enableReconnection) {
            logger.debug('Kernel reconnection disabled by user settings');
            return results;
        }

        // Clean up stale states first
        await this.cleanupStaleStates();

        const allStates = await this.loadPersistedKernelStates();

        // Filter to only kernels from current environment
        const currentEnvironmentStates = allStates.filter((state) => this.isCurrentEnvironment(state));

        logger.info(
            `Attempting to reconnect to ${
                currentEnvironmentStates.length
            } persisted kernels in current environment (${this.getCurrentEnvironmentType()})`
        );

        if (allStates.length > currentEnvironmentStates.length) {
            logger.debug(
                `Skipping ${allStates.length - currentEnvironmentStates.length} kernels from other environments`
            );
        }

        for (const state of currentEnvironmentStates) {
            try {
                const result = await this.attemptKernelReconnection(state);
                results.push(result);

                if (result.success) {
                    logger.info(`Successfully reconnected to kernel ${state.kernelId}`);
                } else {
                    logger.warn(`Failed to reconnect to kernel ${state.kernelId}: ${result.error}`);
                    // Remove failed reconnection state
                    await this.removeKernelState(state.kernelId);
                }
            } catch (ex) {
                logger.error(`Error during reconnection attempt for kernel ${state.kernelId}`, ex);
                results.push({
                    kernelId: state.kernelId,
                    resourceUri: state.resourceUri,
                    success: false,
                    error: ex instanceof Error ? ex.message : 'Unknown error'
                });
            }
        }

        return results;
    }

    async cleanupStaleStates(): Promise<void> {
        try {
            const maxAge = this.getMaxPersistenceAge();
            const cutoffTime = Date.now() - maxAge;
            let removedCount = 0;

            for (const [kernelId, state] of this.persistedStates) {
                if (state.lastActivity < cutoffTime) {
                    this.persistedStates.delete(kernelId);
                    removedCount++;
                }
            }

            if (removedCount > 0) {
                await this.saveStatesToMemento();
                logger.info(`Cleaned up ${removedCount} stale kernel states`);
            }
        } catch (ex) {
            logger.error('Failed to cleanup stale kernel states', ex);
        }
    }

    dispose(): void {
        dispose(this.disposables);
    }

    private async loadStatesFromMemento(): Promise<void> {
        try {
            const storageKey = this.getStorageKey();
            const states = this.globalMemento.get<PersistedKernelState[]>(storageKey, []);

            this.persistedStates.clear();
            for (const state of states) {
                // Ensure backward compatibility by adding environment info if missing
                if (!state.environmentType) {
                    state.environmentType = 'local';
                    state.remoteName = state.remoteName || 'local';
                }
                this.persistedStates.set(state.kernelId, state);
            }

            logger.debug(`Loaded ${states.length} kernel states from storage key: ${storageKey}`);
        } catch (ex) {
            logger.error('Failed to load kernel states from memento', ex);
            this.persistedStates.clear();
        }
    }

    private async saveStatesToMemento(): Promise<void> {
        try {
            const storageKey = this.getStorageKey();
            const states = Array.from(this.persistedStates.values());
            await this.globalMemento.update(storageKey, states);
            logger.debug(`Saved ${states.length} kernel states to storage key: ${storageKey}`);
        } catch (ex) {
            logger.error('Failed to save kernel states to memento', ex);
        }
    }

    private async attemptKernelReconnection(state: PersistedKernelState): Promise<ReconnectionResult> {
        // This method will be implemented with actual reconnection logic
        // For now, return a placeholder result
        return {
            kernelId: state.kernelId,
            resourceUri: state.resourceUri,
            success: false,
            error: 'Reconnection logic not yet implemented'
        };
    }

    private extractProcessId(kernel: IKernel): number | undefined {
        // Extract process ID from kernel session if available
        // Implementation depends on kernel type and session structure
        try {
            // This is a placeholder - actual implementation would depend on
            // the specific kernel session type and its process information
            return undefined;
        } catch {
            return undefined;
        }
    }

    private extractConnectionFile(kernel: IKernel): string | undefined {
        // Extract ZMQ connection file path for local kernels
        // Implementation depends on raw kernel session structure
        try {
            // This is a placeholder - actual implementation would extract
            // connection file path from raw kernel sessions
            return undefined;
        } catch {
            return undefined;
        }
    }

    private getReconnectionSetting(): boolean {
        return workspace.getConfiguration('jupyter').get<boolean>('enablePersistentSessions', true);
    }

    private getMaxPersistenceAge(): number {
        const hours = workspace
            .getConfiguration('jupyter')
            .get<number>('persistentSessionTimeout', KernelPersistenceService.MAX_PERSISTENCE_AGE_HOURS);
        return hours * 60 * 60 * 1000; // Convert to milliseconds
    }
}
