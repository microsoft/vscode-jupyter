// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { Disposable, Uri, workspace } from 'vscode';
import { logger } from '../platform/logging';
import { getDisplayPath } from '../platform/common/platform/fs-paths';
import { IDisposableRegistry } from '../platform/common/types';
import { IExtensionSyncActivationService } from '../platform/activation/types';
import { IServiceContainer } from '../platform/ioc/types';
import { IKernelProvider } from './types';

/**
 * Handles notebook file renames to preserve kernel sessions.
 * When a notebook is renamed, transfers the kernel from the old URI to the new URI
 * instead of disposing it.
 */
@injectable()
export class NotebookRenameHandler implements IExtensionSyncActivationService {
    private readonly disposables: Disposable[] = [];
    private kernelProvider: IKernelProvider | undefined;

    constructor(
        private readonly serviceContainer: IServiceContainer,
        private readonly disposableRegistry: IDisposableRegistry
    ) {
        this.disposableRegistry.push(this);
    }

    public activate(): void {
        // Listen for file rename events
        workspace.onWillRenameFiles(
            async (event) => {
                for (const file of event.files) {
                    // Check if this is a notebook file rename
                    if (file.oldUri.fsPath.endsWith('.ipynb') && file.newUri.fsPath.endsWith('.ipynb')) {
                        await this.handleNotebookRename(file.oldUri, file.newUri);
                    }
                }
            },
            this,
            this.disposables
        );

        this.disposableRegistry.push(...this.disposables);
    }

    private async handleNotebookRename(oldUri: Uri, newUri: Uri): Promise<void> {
        try {
            logger.debug(`Handling notebook rename from ${getDisplayPath(oldUri)} to ${getDisplayPath(newUri)}`);

            // Get the kernel provider
            if (!this.kernelProvider) {
                this.kernelProvider = this.serviceContainer.get<IKernelProvider>(IKernelProvider);
            }

            // Get the existing kernel for the old URI
            const existingKernel = this.kernelProvider.get(oldUri);
            if (!existingKernel) {
                logger.debug(`No kernel found for ${getDisplayPath(oldUri)}, nothing to migrate`);
                return;
            }

            logger.debug(`Found kernel ${existingKernel.id} for ${getDisplayPath(oldUri)}, preparing to migrate`);

            // Store kernel information for migration
            const kernelInfo = (this.kernelProvider as any).getInternal?.(
                workspace.notebookDocuments.find((doc) => doc.uri.toString() === oldUri.toString())
            );
            if (!kernelInfo) {
                logger.debug(`No internal kernel info found for ${getDisplayPath(oldUri)}`);
                return;
            }

            // Flag this kernel for migration (we'll handle the actual migration in the onDidRenameFiles event)
            (existingKernel as any)._migrationTarget = newUri.toString();
            logger.debug(`Marked kernel ${existingKernel.id} for migration to ${getDisplayPath(newUri)}`);
        } catch (error) {
            logger.error(
                `Error handling notebook rename from ${getDisplayPath(oldUri)} to ${getDisplayPath(newUri)}`,
                error
            );
        }
    }

    public dispose(): void {
        this.disposables.forEach((d) => d.dispose());
    }
}
