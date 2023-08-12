// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken, CancellationTokenSource, Disposable, EventEmitter, NotebookDocument } from 'vscode';
import { ContributedKernelFinderKind, IContributedKernelFinder } from '../../../kernels/internalTypes';
import { KernelConnectionMetadata } from '../../../kernels/types';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { getDisplayPath } from '../../../platform/common/platform/fs-paths';
import { IDisposable } from '../../../platform/common/types';
import { isPromise } from '../../../platform/common/utils/async';
import { DataScience } from '../../../platform/common/utils/localize';
import { traceError } from '../../../platform/logging';
import { PythonEnvironmentFilter } from '../../../platform/interpreter/filter/filterService';
import { PreferredKernelConnectionService } from '../preferredKernelConnectionService';
import { IQuickPickKernelItemProvider } from './types';
import { JupyterConnection } from '../../../kernels/jupyter/connection';

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
                .catch((ex) => traceError(`Failed to setup finder for ${this.title}`, ex));
        } else {
            this.setupFinder(finderPromise);
        }
    }
    public dispose() {
        disposeAllDisposables(this.disposables);
    }
    private setupFinder(finder: IContributedKernelFinder) {
        this.refresh = async () => finder.refresh();
        if (this.status !== finder.status && !this.refreshInvoked) {
            this.status = finder.status;
            this._onDidChangeStatus.fire();
        }
        if (this.refreshInvoked) {
            finder.refresh().catch((ex) => traceError(`Failed to refresh finder for ${this.title}`, ex));
        } else if (
            // If we're dealing with remote and we are idle and there are no kernels,
            // then trigger a refresh.
            finder.kind === ContributedKernelFinderKind.Remote &&
            finder.status === 'idle' &&
            this.filteredKernels(finder.kernels).length === 0
        ) {
            finder.refresh().catch((ex) => traceError(`Failed to refresh finder for ${this.title}`, ex));
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
                this.kernels.length = 0;
                this.kernels.push(...this.filteredKernels(finder.kernels));
                this._onDidChange.fire();
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
        this.kernels.length = 0;
        this.kernels.push(...this.filteredKernels(finder.kernels));
        this._onDidChange.fire();
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
    private filteredKernels(kernels: KernelConnectionMetadata[]) {
        const filter = this.pythonEnvFilter;
        if (!filter) {
            return kernels;
        }
        return kernels.filter(
            (k) => k.kind !== 'startUsingPythonInterpreter' || !filter!.isPythonEnvironmentExcluded(k.interpreter)
        );
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
            .catch((ex) => traceError(`Preferred connection failure ${getDisplayPath(this.notebook.uri)}`, ex));
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
                .catch((ex) => traceError(`Preferred connection failure ${getDisplayPath(this.notebook?.uri)}`, ex));
        };
        computePreferred();
        finder.onDidChangeKernels(computePreferred, this, this.disposables);
    }
}
