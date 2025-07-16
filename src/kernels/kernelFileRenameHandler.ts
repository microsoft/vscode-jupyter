// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { CancellationToken, CancellationTokenSource, FileRenameEvent, Uri, workspace } from 'vscode';
import { IExtensionSyncActivationService } from '../platform/activation/types';
import { IDisposableRegistry } from '../platform/common/types';
import { logger } from '../platform/logging';
import { getDisplayPath } from '../platform/common/platform/fs-paths';
import { IKernelProvider } from './types';
import { IControllerRegistration } from '../notebooks/controllers/types';

/**
 * Handles file rename events to preserve kernel sessions when notebook files are renamed.
 * When a notebook file is renamed, we need to migrate the kernel from the old file to the new file
 * to maintain the kernel state and avoid unnecessary restarts.
 */
@injectable()
export class KernelFileRenameHandler implements IExtensionSyncActivationService {
    private readonly pendingMigrations = new Map<string, { oldUri: Uri; newUri: Uri; kernel?: any }>();

    constructor(
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IControllerRegistration) private readonly controllerRegistration: IControllerRegistration,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry
    ) {}

    public activate(): void {
        // Listen for file rename events to capture old kernel state
        this.disposables.push(
            workspace.onWillRenameFiles(async (event: FileRenameEvent) => {
                await this.prepareForFileRename(event, new CancellationTokenSource().token);
            })
        );

        // Listen for file rename completion to migrate kernels to new documents
        this.disposables.push(
            workspace.onDidRenameFiles(async (event: FileRenameEvent) => {
                await this.handleFileRename(event, new CancellationTokenSource().token);
            })
        );
    }

    private async prepareForFileRename(event: FileRenameEvent, token: CancellationToken): Promise<void> {
        for (const rename of event.files) {
            if (token.isCancellationRequested) {
                return;
            }
            
            const { oldUri, newUri } = rename;
            
            // Only handle .ipynb files
            if (!this.isNotebookFile(oldUri) || !this.isNotebookFile(newUri)) {
                continue;
            }

            logger.debug(`Preparing for notebook file rename from ${oldUri.fsPath} to ${newUri.fsPath}`);
            
            // Get the kernel associated with the old URI and store it for migration
            const existingKernel = this.kernelProvider.get(oldUri);
            
            if (existingKernel) {
                logger.debug(`Found kernel ${existingKernel.id} for old URI ${oldUri.fsPath}, storing for migration`);
                this.pendingMigrations.set(oldUri.toString(), {
                    oldUri,
                    newUri,
                    kernel: existingKernel
                });
            }
        }
    }

    private async handleFileRename(event: FileRenameEvent, token: CancellationToken): Promise<void> {
        for (const rename of event.files) {
            if (token.isCancellationRequested) {
                return;
            }
            
            const { oldUri, newUri } = rename;
            
            // Only handle .ipynb files
            if (!this.isNotebookFile(oldUri) || !this.isNotebookFile(newUri)) {
                continue;
            }

            const migration = this.pendingMigrations.get(oldUri.toString());
            if (!migration || !migration.kernel) {
                continue;
            }

            logger.debug(`Executing kernel migration for notebook file rename from ${oldUri.fsPath} to ${newUri.fsPath}`);
            
            try {
                await this.migrateKernelForRename(oldUri, newUri, migration.kernel, token);
            } catch (error) {
                logger.error(`Failed to migrate kernel for rename from ${oldUri.fsPath} to ${newUri.fsPath}`, error);
            } finally {
                // Clean up pending migration
                this.pendingMigrations.delete(oldUri.toString());
            }
        }
    }

    private isNotebookFile(uri: Uri): boolean {
        return uri.fsPath.toLowerCase().endsWith('.ipynb');
    }

    private async migrateKernelForRename(oldUri: Uri, newUri: Uri, kernel: any, token: CancellationToken): Promise<void> {
        if (token.isCancellationRequested) {
            return;
        }
        
        // Find the old and new notebook documents
        const oldNotebook = workspace.notebookDocuments.find((doc: any) => doc.uri.toString() === oldUri.toString());
        const newNotebook = workspace.notebookDocuments.find((doc: any) => doc.uri.toString() === newUri.toString());

        if (!oldNotebook) {
            logger.debug(`Old notebook document not found for URI ${oldUri.fsPath}`);
            return;
        }

        if (!newNotebook) {
            logger.debug(`New notebook document not found for URI ${newUri.fsPath}, will wait for it to open`);
            return;
        }

        if (token.isCancellationRequested) {
            return;
        }

        logger.debug(`Migrating kernel ${kernel.id} from ${getDisplayPath(oldNotebook.uri)} to ${getDisplayPath(newNotebook.uri)}`);

        // Migrate the kernel in the kernel provider
        if (this.kernelProvider.migrateKernel) {
            const migrated = this.kernelProvider.migrateKernel(oldNotebook, newNotebook);
            if (migrated) {
                logger.debug(`Successfully migrated kernel in kernel provider`);
            }
        }

        // Migrate kernel mappings in all relevant controllers
        for (const controller of this.controllerRegistration.registered) {
            if (token.isCancellationRequested) {
                return;
            }
            
            if (controller.migrateKernelMapping && controller.isAssociatedWithDocument(oldNotebook)) {
                const migrated = controller.migrateKernelMapping(oldNotebook, newNotebook);
                if (migrated) {
                    logger.debug(`Successfully migrated kernel mapping in controller ${controller.id}`);
                }
            }
        }
    }
}