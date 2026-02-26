// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken, CancellationTokenSource, Disposable, EventEmitter, NotebookDocument } from 'vscode';
import { ContributedKernelFinderKind, IContributedKernelFinder } from '../../../kernels/internalTypes';
import { KernelConnectionMetadata } from '../../../kernels/types';
import { dispose } from '../../../platform/common/utils/lifecycle';
import { getDisplayPath } from '../../../platform/common/platform/fs-paths';
import { IDisposable } from '../../../platform/common/types';
import { isPromise } from '../../../platform/common/utils/async';
import { DataScience } from '../../../platform/common/utils/localize';
import { logger } from '../../../platform/logging';
import { PythonEnvironmentFilter } from '../../../platform/interpreter/filter/filterService';
import { PreferredKernelConnectionService } from '../preferredKernelConnectionService';
import { IQuickPickKernelItemProvider } from './types';
import { JupyterConnection } from '../../../kernels/jupyter/connection/jupyterConnection';

export class QuickPickKernelItemProvider implements IQuickPickKernelItemProvider {
    private readonly _onDidRefresh = new EventEmitter<void>();
    onDidRefresh = this._onDidRefresh.event;
    title: string;
    kind: ContributedKernelFinderKind;
    private readonly _onDidChange = new EventEmitter<void>();
    onDidChange = this._onDidChange.event;
    kernels: KernelConnectionMetadata[] = [];
    private readonly _onDidChangeStatus = new EventEmitter<void>();
    onDidChangeStatus = this._onDidChangeStatus.event;
    private readonly _onDidChangeRecommended = new EventEmitter<void>();
    onDidChangeRecommended = this._onDidChangeRecommended.event;
    private readonly _onDidFailToListKernels = new EventEmitter<Error>();
    onDidFailToListKernels = this._onDidFailToListKernels.event;
    status: 'discovering' | 'idle' = 'idle';
    refresh: () => Promise<void>;
    recommended: KernelConnectionMetadata | undefined;
    private readonly disposables: IDisposable[] = [];
    private refreshInvoked?: boolean;
    constructor(
        private readonly notebook: NotebookDocument,
        kind: ContributedKernelFinderKind,
        finderPromise: IContributedKernelFinder | Promise<IContributedKernelFinder>,
        private readonly pythonEnvFilter: PythonEnvironmentFilter | undefined,
        private readonly connection: JupyterConnection
    ) {
        this.refresh = async () => {
            this.refreshInvoked = true;
        };
        this.title = DataScience.kernelPickerSelectKernelTitle;
        this.kind = kind;
        this.disposables.push(this._onDidRefresh);
        if (isPromise(finderPromise)) {
            finderPromise
                .then((finder) => this.setupFinder(finder))
                .catch((ex) => logger.error(`Failed to setup finder for ${this.title}`, ex));
        } else {
            this.setupFinder(finderPromise);
        }
    }
    public dispose() {
        dispose(this.disposables);
    }
    private setupFinder(finder: IContributedKernelFinder) {
        this.refresh = async () => finder.refresh();
        if (this.status !== finder.status && !this.refreshInvoked) {
            this.status = finder.status;
            this._onDidChangeStatus.fire();
        }
        if (this.refreshInvoked) {
            finder.refresh().catch((ex) => logger.error(`Failed to refresh finder for ${this.title}`, ex));
        } else if (
            // If we're dealing with remote and we are idle and there are no kernels,
            // then trigger a refresh.
            finder.kind === ContributedKernelFinderKind.Remote &&
            finder.status === 'idle' &&
            this.filteredKernels(finder.kernels).length === 0
        ) {
            finder.refresh().catch((ex) => logger.error(`Failed to refresh finder for ${this.title}`, ex));
        }
        switch (finder.kind) {
            case ContributedKernelFinderKind.LocalKernelSpec:
                this.title = DataScience.kernelPickerSelectLocalKernelSpecTitle;
                break;
            case ContributedKernelFinderKind.LocalPythonEnvironment:
                this.title = DataScience.quickPickSelectPythonEnvironmentTitle;
                break;
            default:
                this.title = DataScience.kernelPickerSelectKernelFromRemoteTitle(finder.displayName);
                break;
        }
        finder.onDidChangeKernels(
            () => {
                this.updateKernelsWithAccessControl(finder.kernels);
            },
            this,
            this.disposables
        );
        finder.onDidChangeStatus(() => {
            this.status = finder.status;
            this._onDidChangeStatus.fire();

            if (this.status === 'idle' && finder.lastError && this.filteredKernels(finder.kernels).length === 0) {
                // Ok we have an error and there are no kernels to be displayed.
                // Notify the user about this error.
                this.kernels.length = 0;
                this._onDidFailToListKernels.fire(finder.lastError);
            }
        });

        // Initial kernel population with access control
        this.updateKernelsWithAccessControl(finder.kernels);
        this._onDidChangeStatus.fire();

        // We need a cancellation in case the user aborts the quick pick
        const cancellationToken = new CancellationTokenSource();
        this.disposables.push(new Disposable(() => cancellationToken.cancel()));
        this.disposables.push(cancellationToken);
        const preferred = new PreferredKernelConnectionService(this.connection);
        this.disposables.push(preferred);

        if (finder.kind === ContributedKernelFinderKind.Remote) {
            this.computePreferredRemoteKernel(finder, preferred, cancellationToken.token);
        } else {
            this.computePreferredLocalKernel(finder, preferred, cancellationToken.token);
        }
    }

    private updateKernelsWithAccessControl(kernels: KernelConnectionMetadata[]): void {
        this.filteredKernelsWithAccessControl(kernels)
            .then((filtered) => {
                this.kernels.length = 0;
                this.kernels.push(...filtered);
                this._onDidChange.fire();
            })
            .catch((ex) => {
                logger.error('Failed to filter kernels with access control', ex);
                // Fallback to basic filtering
                this.kernels.length = 0;
                this.kernels.push(...this.filteredKernels(kernels));
                this._onDidChange.fire();
            });
    }
    private async filteredKernelsWithAccessControl(
        kernels: KernelConnectionMetadata[]
    ): Promise<KernelConnectionMetadata[]> {
        // First apply Python environment filter
        const filter = this.pythonEnvFilter;
        let filtered = kernels;
        if (filter) {
            filtered = kernels.filter(
                (k) => k.kind !== 'startUsingPythonInterpreter' || !filter!.isPythonEnvironmentExcluded(k.interpreter)
            );
        }

        // Then apply access control filter — only for remote kernels
        try {
            const { ServiceContainer } = await import('../../../platform/ioc/container');
            const { IKernelAccessService } = await import('../../../kernels/access/types');
            const accessService =
                ServiceContainer.instance.get<import('../../../kernels/access/types').IKernelAccessService>(
                    IKernelAccessService
                );

            let userEmail = accessService.getUserEmail();
            if (!userEmail) {
                // Try to extract from kernels (Meesho specific)
                userEmail = this.getUserEmailFromKernels(filtered);
            }

            if (!userEmail) {
                logger.warn('QuickPickKernelItemProvider: No user email found, skipping access control');
                return filtered;
            }

            // For each kernel, check access dynamically via the API.
            // Local kernels are always allowed; only remote kernels are checked.
            const accessChecks = await Promise.all(
                filtered.map(async (kernel) => {
                    // Only apply access control to remote kernels
                    if (kernel.kind !== 'connectToLiveRemoteKernel' && kernel.kind !== 'startUsingRemoteKernelSpec') {
                        return { kernel, hasAccess: true };
                    }

                    const kernelName = this.getKernelName(kernel);
                    if (!kernelName) {
                        logger.warn(`QuickPickKernelItemProvider: Kernel has no name, allowing by default`);
                        return { kernel, hasAccess: true };
                    }

                    // Use the kernel spec name directly as the category — the API is the source of truth
                    const hasAccess = await accessService.verifyAccess(kernelName, userEmail!);
                    logger.debug(`QuickPickKernelItemProvider: Access check for '${kernelName}': ${hasAccess}`);
                    return { kernel, hasAccess };
                })
            );

            const accessibleKernels = accessChecks.filter((check) => check.hasAccess).map((check) => check.kernel);

            logger.debug(
                `QuickPickKernelItemProvider: Filtered ${filtered.length} kernels to ${accessibleKernels.length} accessible kernels for user ${userEmail}`
            );

            return accessibleKernels;
        } catch (error) {
            logger.error(
                'QuickPickKernelItemProvider: Error applying access control, returning all filtered kernels',
                error
            );
            return filtered;
        }
    }

    private getUserEmailFromKernels(kernels: KernelConnectionMetadata[]): string | undefined {
        for (const kernel of kernels) {
            if (kernel.kind === 'connectToLiveRemoteKernel' || kernel.kind === 'startUsingRemoteKernelSpec') {
                const baseUrl = kernel.baseUrl;
                if (baseUrl) {
                    const match = baseUrl.match(/\/user\/([^/]+)\//);
                    if (match && match[1]) {
                        const user = match[1];
                        return user.includes('@') ? user : `${user}@meesho.com`;
                    }
                }
            }
        }
        return undefined;
    }

    private filteredKernels(kernels: KernelConnectionMetadata[]) {
        const filter = this.pythonEnvFilter;
        if (!filter) {
            return kernels;
        }
        return kernels.filter(
            (k) => k.kind !== 'startUsingPythonInterpreter' || !filter!.isPythonEnvironmentExcluded(k.interpreter)
        );
    }

    private getKernelName(kernel: KernelConnectionMetadata): string {
        if (kernel.kind === 'connectToLiveRemoteKernel') {
            return kernel.kernelModel.name || kernel.kernelModel.display_name || '';
        }
        return kernel.kernelSpec?.name || kernel.kernelSpec?.display_name || '';
    }

    private computePreferredRemoteKernel(
        finder: IContributedKernelFinder,
        preferred: PreferredKernelConnectionService,
        cancelToken: CancellationToken
    ) {
        preferred
            .findPreferredRemoteKernelConnection(this.notebook, finder, cancelToken)
            .then((kernel) => {
                this.recommended = kernel;
                this._onDidChangeRecommended.fire();
            })
            .catch((ex) => logger.error(`Preferred connection failure ${getDisplayPath(this.notebook.uri)}`, ex));
    }
    private computePreferredLocalKernel(
        finder: IContributedKernelFinder,
        preferred: PreferredKernelConnectionService,
        cancelToken: CancellationToken
    ) {
        const computePreferred = () => {
            // Check if the preferred kernel is in the list of kernels
            if (this.recommended && !this.kernels.find((k) => k.id === this.recommended?.id)) {
                this.recommended = undefined;
            }
            const preferredMethod =
                finder.kind === ContributedKernelFinderKind.LocalKernelSpec
                    ? preferred.findPreferredLocalKernelSpecConnection.bind(preferred)
                    : preferred.findPreferredPythonKernelConnection.bind(preferred);

            preferredMethod(this.notebook, finder, cancelToken)
                .then((kernel) => {
                    if (this.recommended?.id === kernel?.id) {
                        return;
                    }
                    this.recommended = kernel;
                    this._onDidChangeRecommended.fire();
                })
                .catch((ex) => logger.error(`Preferred connection failure ${getDisplayPath(this.notebook?.uri)}`, ex));
        };
        computePreferred();
        finder.onDidChangeKernels(computePreferred, this, this.disposables);
    }
}
