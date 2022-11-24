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
import { PreferredKernelConnectionService } from '../preferredKernelConnectionService';
import { IQuickPickKernelItemProvider } from './types';

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
    status: 'discovering' | 'idle' = 'idle';
    refresh: () => Promise<void>;
    recommended: KernelConnectionMetadata | undefined;
    private readonly disposables: IDisposable[] = [];
    private refreshInvoked?: boolean;
    private _finder: IContributedKernelFinder | undefined
    public get finder(): IContributedKernelFinder | undefined {
        return this._finder;
    }
    constructor(
        private readonly notebook: NotebookDocument,
        kind: ContributedKernelFinderKind,
        finderPromise: IContributedKernelFinder | Promise<IContributedKernelFinder>
    ) {
        this.refresh = async () => {
            this.refreshInvoked = true;
        };
        this.title = DataScience.kernelPickerSelectKernelTitle();
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
        this._finder = finder;
        this.refresh = async () => finder.refresh();
        if (this.status !== finder.status && !this.refreshInvoked) {
            this.status = finder.status;
            this._onDidChangeStatus.fire();
        }
        if (this.refreshInvoked) {
            finder.refresh().catch((ex) => traceError(`Failed to refresh finder for ${this.title}`, ex));
        }

        this.title = `${DataScience.kernelPickerSelectKernelTitle()} from ${finder.displayName}`;
        finder.onDidChangeKernels(
            () => {
                this.kernels.length = 0;
                this.kernels.push(...finder.kernels);
                this._onDidChange.fire();
            },
            this,
            this.disposables
        );
        finder.onDidChangeStatus(() => {
            this.status = finder.status;
            this._onDidChangeStatus.fire();
        });
        this.kernels.length = 0;
        this.kernels.push(...finder.kernels);
        this._onDidChange.fire();
        this._onDidChangeStatus.fire();

        // We need a cancellation in case the user aborts the quick pick
        const cancellationToken = new CancellationTokenSource();
        this.disposables.push(new Disposable(() => cancellationToken.cancel()));
        this.disposables.push(cancellationToken);
        const preferred = new PreferredKernelConnectionService();
        this.disposables.push(preferred);

        if (finder.kind === ContributedKernelFinderKind.Remote) {
            this.computePreferredRemoteKernel(finder, preferred, cancellationToken.token);
        } else {
            this.computePreferredLocalKernel(finder, preferred, cancellationToken.token);
        }
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
            if (this.recommended) {
                return;
            }
            const preferredMethod =
                finder.kind === ContributedKernelFinderKind.LocalKernelSpec
                    ? preferred.findPreferredLocalKernelSpecConnection.bind(preferred)
                    : preferred.findPreferredPythonKernelConnection.bind(preferred);

            preferredMethod(this.notebook, finder, cancelToken)
                .then((kernel) => {
                    if (this.recommended) {
                        return;
                    }
                    this.recommended = kernel;
                    this._onDidChangeRecommended.fire();
                })
                .catch((ex) => traceError(`Preferred connection failure ${getDisplayPath(this.notebook.uri)}`, ex));
        };
        computePreferred();
        finder.onDidChangeKernels(computePreferred, this, this.disposables);
    }
}
