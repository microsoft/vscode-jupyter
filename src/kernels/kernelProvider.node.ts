// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, multiInject, named } from 'inversify';
import { Memento, NotebookDocument, Uri } from 'vscode';
import {
    IAsyncDisposableRegistry,
    IConfigurationService,
    IDisposableRegistry,
    IExtensionContext,
    IMemento,
    WORKSPACE_MEMENTO
} from '../platform/common/types';
import { BaseCoreKernelProvider, BaseThirdPartyKernelProvider } from './kernelProvider.base';
import { InteractiveWindowView, JupyterNotebookView } from '../platform/common/constants';
import { Kernel, ThirdPartyKernel } from './kernel';
import {
    IThirdPartyKernel,
    IKernel,
    ITracebackFormatter,
    KernelOptions,
    ThirdPartyKernelOptions,
    IStartupCodeProviders,
    IKernelSessionFactory,
    IKernelWorkingDirectory,
    BaseKernelConnectionMetadata
} from './types';
import { IJupyterServerUriStorage } from './jupyter/types';
import { createKernelSettings } from './kernelSettings';
import { NotebookKernelExecution } from './kernelExecution';
import { IReplNotebookTrackerService } from '../platform/notebooks/replNotebookTrackerService';
import { logger } from '../platform/logging';
import { getDisplayPath } from '../platform/common/platform/fs-paths';
import { IRawNotebookSupportedService } from './raw/types';
import { IKernelPersistenceService, PersistedKernelState } from './kernelPersistenceService';
import { IKernelConnectionRestorer } from './kernelConnectionRestorer';

/**
 * Node version of a kernel provider. Needed in order to create the node version of a kernel.
 */
@injectable()
export class KernelProvider extends BaseCoreKernelProvider {
    constructor(
        @inject(IAsyncDisposableRegistry) asyncDisposables: IAsyncDisposableRegistry,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IKernelSessionFactory) private sessionCreator: IKernelSessionFactory,
        @inject(IConfigurationService) private configService: IConfigurationService,
        @inject(IExtensionContext) private readonly context: IExtensionContext,
        @inject(IJupyterServerUriStorage) jupyterServerUriStorage: IJupyterServerUriStorage,
        @multiInject(ITracebackFormatter)
        private readonly formatters: ITracebackFormatter[],
        @inject(IStartupCodeProviders) private readonly startupCodeProviders: IStartupCodeProviders,
        @inject(IMemento) @named(WORKSPACE_MEMENTO) private readonly workspaceStorage: Memento,
        @inject(IReplNotebookTrackerService) private readonly replTracker: IReplNotebookTrackerService,
        @inject(IKernelWorkingDirectory) private readonly kernelWorkingDirectory: IKernelWorkingDirectory,
        @inject(IRawNotebookSupportedService) private readonly rawKernelSupported: IRawNotebookSupportedService,
        @inject(IKernelPersistenceService) private readonly persistenceService: IKernelPersistenceService,
        @inject(IKernelConnectionRestorer) private readonly connectionRestorer: IKernelConnectionRestorer
    ) {
        super(asyncDisposables, disposables);
        disposables.push(jupyterServerUriStorage.onDidRemove(this.handleServerRemoval.bind(this)));
    }

    public getOrCreate(notebook: NotebookDocument, options: KernelOptions): IKernel {
        const existingKernelInfo = this.getInternal(notebook);
        if (existingKernelInfo && existingKernelInfo.options.metadata.id === options.metadata.id) {
            return existingKernelInfo.kernel;
        }

        // Check for persisted kernel before creating new one (asynchronously)
        if (!existingKernelInfo) {
            this.attemptReconnectionAsync(notebook, options).catch((ex) =>
                logger.debug('Background reconnection attempt failed', ex)
            );
        }

        if (existingKernelInfo) {
            logger.trace(
                `Kernel for ${getDisplayPath(notebook.uri)} with id ${
                    existingKernelInfo.options.metadata.id
                } is being replaced with ${options.metadata.id}`
            );
        }
        this.disposeOldKernel(notebook, 'createNewKernel');

        const replKernel = this.replTracker.isForReplEditor(notebook);
        const resourceUri = replKernel ? options.resourceUri : notebook.uri;
        const settings = createKernelSettings(this.configService, resourceUri);
        const startupCodeProviders = this.startupCodeProviders.getProviders(
            replKernel ? InteractiveWindowView : JupyterNotebookView
        );

        const kernel: IKernel = new Kernel(
            resourceUri,
            notebook,
            options.metadata,
            this.sessionCreator,
            settings,
            options.controller,
            startupCodeProviders,
            this.workspaceStorage,
            this.kernelWorkingDirectory,
            this.rawKernelSupported
        );
        kernel.onRestarted(() => this._onDidRestartKernel.fire(kernel), this, this.disposables);
        kernel.onDisposed(
            () => {
                this._onDidDisposeKernel.fire(kernel);
            },
            this,
            this.disposables
        );
        kernel.onStarted(() => this._onDidStartKernel.fire(kernel), this, this.disposables);
        kernel.onStatusChanged(
            (status) => this._onKernelStatusChanged.fire({ kernel, status }),
            this,
            this.disposables
        );
        kernel.onPostInitialized(
            (e) => e.waitUntil(this._onDidPostInitializeKernel.fireAsync({ kernel }, e.token)),
            this,
            this.disposables
        );

        this.executions.set(kernel, new NotebookKernelExecution(kernel, this.context, this.formatters, notebook));
        this.asyncDisposables.push(kernel);
        this.storeKernel(notebook, options, kernel);
        this.deleteMappingIfKernelIsDisposed(kernel);
        return kernel;
    }

    /**
     * Attempt reconnection asynchronously without blocking kernel creation
     */
    private async attemptReconnectionAsync(notebook: NotebookDocument, options: KernelOptions): Promise<void> {
        try {
            const persistedState = await this.findPersistedKernelForNotebook(notebook);
            if (persistedState && persistedState.connectionMetadata.kind === options.metadata.kind) {
                const reconnectedKernel = await this.attemptKernelReconnection(notebook, persistedState);
                if (reconnectedKernel) {
                    logger.info(
                        `Successfully reconnected to kernel ${persistedState.kernelId} for notebook ${getDisplayPath(
                            notebook.uri
                        )}`
                    );
                    // Replace the newly created kernel with the reconnected one if needed
                } else {
                    // Cleanup failed reconnection state
                    await this.removeKernelStateFromPersistence(persistedState.kernelId);
                }
            }
        } catch (ex) {
            logger.debug('Async reconnection attempt failed', ex);
        }
    }

    // Override persistence hooks with actual implementations
    protected async saveKernelStateForReconnection(kernel: IKernel, resourceUri: Uri): Promise<void> {
        try {
            await this.persistenceService.saveKernelState(kernel, resourceUri);
            logger.debug(`Saved kernel state for reconnection: ${kernel.id}`);
        } catch (ex) {
            logger.debug('Failed to save kernel state for reconnection', ex);
        }
    }

    protected async removeKernelStateFromPersistence(kernelId: string): Promise<void> {
        try {
            await this.persistenceService.removeKernelState(kernelId);
            logger.debug(`Removed kernel state from persistence: ${kernelId}`);
        } catch (ex) {
            logger.debug('Failed to remove kernel state from persistence', ex);
        }
    }

    protected async findPersistedKernelForNotebook(
        notebook: NotebookDocument
    ): Promise<PersistedKernelState | undefined> {
        try {
            const states = await this.persistenceService.loadPersistedKernelStates();
            const notebookUri = notebook.uri.toString();

            // Find persisted state matching this notebook
            const matchingState = states.find((state) => state.resourceUri === notebookUri);

            if (matchingState) {
                logger.debug(
                    `Found persisted kernel ${matchingState.kernelId} for notebook: ${getDisplayPath(notebook.uri)}`
                );
            }

            return matchingState;
        } catch (ex) {
            logger.debug('Failed to find persisted kernel for notebook', ex);
            return undefined;
        }
    }

    protected async attemptKernelReconnection(
        notebook: NotebookDocument,
        persistedState: PersistedKernelState
    ): Promise<IKernel | undefined> {
        try {
            logger.debug(`Attempting kernel reconnection for ${persistedState.kernelId}`);

            // Use connection restorer to restore the session
            const restoredSession = await this.connectionRestorer.restoreConnection(persistedState);

            if (!restoredSession) {
                logger.debug(`Failed to restore session for kernel ${persistedState.kernelId}`);
                return undefined;
            }

            // Create kernel from restored session
            const kernel = await this.createKernelFromSession(restoredSession, notebook, persistedState);

            if (kernel) {
                // Store the reconnected kernel
                const options: KernelOptions = {
                    metadata: BaseKernelConnectionMetadata.fromJSON(persistedState.connectionMetadata),
                    controller: kernel.controller,
                    resourceUri: notebook.uri
                };

                this.storeKernel(notebook, options, kernel);
                this.deleteMappingIfKernelIsDisposed(kernel);

                // Set up event handlers
                kernel.onRestarted(() => this._onDidRestartKernel.fire(kernel), this, this.disposables);
                kernel.onDisposed(() => this._onDidDisposeKernel.fire(kernel), this, this.disposables);
                kernel.onStarted(() => this._onDidStartKernel.fire(kernel), this, this.disposables);
                kernel.onStatusChanged(
                    (status) => this._onKernelStatusChanged.fire({ kernel, status }),
                    this,
                    this.disposables
                );
            }

            return kernel;
        } catch (ex) {
            logger.debug('Failed to attempt kernel reconnection', ex);
            return undefined;
        }
    }

    protected async createKernelFromSession(
        session: IKernelSession,
        notebook: NotebookDocument,
        persistedState: PersistedKernelState
    ): Promise<IKernel | undefined> {
        try {
            logger.debug(`Creating kernel from restored session: ${persistedState.kernelId}`);

            // Recreate the connection metadata from persisted state
            const connectionMetadata = BaseKernelConnectionMetadata.fromJSON(persistedState.connectionMetadata);

            // Determine if this is a REPL kernel
            const replKernel = this.replTracker.isForReplEditor(notebook);
            const resourceUri = replKernel ? notebook.uri : notebook.uri;

            // Create kernel settings
            const settings = createKernelSettings(this.configService, resourceUri);

            // Get startup code providers
            const startupCodeProviders = this.startupCodeProviders.getProviders(
                replKernel ? InteractiveWindowView : JupyterNotebookView
            );

            // Create a new kernel with the restored session
            const kernel: IKernel = new Kernel(
                resourceUri,
                notebook,
                connectionMetadata,
                this.sessionCreator,
                settings,
                undefined, // controller will be set later
                startupCodeProviders,
                this.workspaceStorage,
                this.kernelWorkingDirectory,
                this.rawKernelSupported
            );

            // Override the kernel's session with the restored one
            // This is a bit of a hack, but necessary to use the existing connection
            Object.defineProperty(kernel, 'session', {
                value: session,
                writable: false,
                configurable: false
            });

            // Mark the kernel as started since we have a live session
            Object.defineProperty(kernel, 'status', {
                get: () => session.status,
                configurable: false
            });

            // Set up notebook kernel execution tracking
            this.executions.set(kernel, new NotebookKernelExecution(kernel, this.context, this.formatters, notebook));

            // Add to disposables
            this.asyncDisposables.push(kernel);

            logger.info(`Successfully created kernel from restored session: ${persistedState.kernelId}`);
            return kernel;
        } catch (ex) {
            logger.error('Failed to create kernel from restored session', ex);
            return undefined;
        }
    }
}

@injectable()
export class ThirdPartyKernelProvider extends BaseThirdPartyKernelProvider {
    constructor(
        @inject(IAsyncDisposableRegistry) asyncDisposables: IAsyncDisposableRegistry,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IKernelSessionFactory) private sessionCreator: IKernelSessionFactory,
        @inject(IConfigurationService) private configService: IConfigurationService,
        @inject(IStartupCodeProviders) private readonly startupCodeProviders: IStartupCodeProviders,
        @inject(IMemento) @named(WORKSPACE_MEMENTO) private readonly workspaceStorage: Memento,
        @inject(IKernelWorkingDirectory) private readonly kernelWorkingDirectory: IKernelWorkingDirectory,
        @inject(IRawNotebookSupportedService) private readonly rawKernelSupported: IRawNotebookSupportedService
    ) {
        super(asyncDisposables, disposables);
    }

    public getOrCreate(uri: Uri, options: ThirdPartyKernelOptions): IThirdPartyKernel {
        const existingKernelInfo = this.getInternal(uri);
        if (existingKernelInfo && existingKernelInfo.options.metadata.id === options.metadata.id) {
            return existingKernelInfo.kernel;
        }
        this.disposeOldKernel(uri);

        const resourceUri = uri;
        const settings = createKernelSettings(this.configService, resourceUri);
        const notebookType = resourceUri.path.endsWith('.interactive') ? InteractiveWindowView : JupyterNotebookView;
        const kernel: IThirdPartyKernel = new ThirdPartyKernel(
            uri,
            resourceUri,
            options.metadata,
            this.sessionCreator,
            settings,
            this.startupCodeProviders.getProviders(notebookType),
            this.workspaceStorage,
            this.kernelWorkingDirectory,
            this.rawKernelSupported
        );
        kernel.onRestarted(() => this._onDidRestartKernel.fire(kernel), this, this.disposables);
        kernel.onDisposed(
            () => {
                this._onDidDisposeKernel.fire(kernel);
            },
            this,
            this.disposables
        );
        kernel.onStarted(() => this._onDidStartKernel.fire(kernel), this, this.disposables);
        kernel.onStatusChanged(
            (status) => this._onKernelStatusChanged.fire({ kernel, status }),
            this,
            this.disposables
        );
        kernel.onPostInitialized(
            (e) => e.waitUntil(this._onDidPostInitializeKernel.fireAsync({ kernel }, e.token)),
            this,
            this.disposables
        );
        this.asyncDisposables.push(kernel);
        this.storeKernel(uri, options, kernel);
        this.deleteMappingIfKernelIsDisposed(uri, kernel);
        return kernel;
    }
}
