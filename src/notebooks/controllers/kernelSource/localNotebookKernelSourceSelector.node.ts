// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { CancellationError, CancellationToken, CancellationTokenSource, NotebookDocument, QuickPickItem } from 'vscode';
import { ContributedKernelFinderKind, IContributedKernelFinder } from '../../../kernels/internalTypes';
import { IKernelFinder, KernelConnectionMetadata, LocalKernelConnectionMetadata } from '../../../kernels/types';
import { IWorkspaceService } from '../../../platform/common/application/types';
import { InteractiveWindowView, JupyterNotebookView } from '../../../platform/common/constants';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { IDisposable } from '../../../platform/common/types';
import {
    IMultiStepInput,
    IMultiStepInputFactory,
    InputFlowAction,
    InputStep
} from '../../../platform/common/utils/multiStepInput';
import { PythonEnvironmentFilter } from '../../../platform/interpreter/filter/filterService';
import { ILocalNotebookKernelSourceSelector } from '../types';
import { QuickPickKernelItemProvider } from './quickPickKernelItemProvider';
import { ConnectionQuickPickItem, IQuickPickKernelItemProvider, MultiStepResult } from './types';
import { JupyterConnection } from '../../../kernels/jupyter/connection/jupyterConnection';
import { LocalKernelSelector } from './localKernelSelector.node';
import { CreateAndSelectItemFromQuickPick } from './baseKernelSelector';

// Provides the UI to select a Kernel Source for a given notebook document
@injectable()
export class LocalNotebookKernelSourceSelector implements ILocalNotebookKernelSourceSelector {
    private localDisposables: IDisposable[] = [];
    private cancellationTokenSource: CancellationTokenSource | undefined;
    constructor(
        @inject(IKernelFinder) private readonly kernelFinder: IKernelFinder,
        @inject(IMultiStepInputFactory) private readonly multiStepFactory: IMultiStepInputFactory,
        @inject(PythonEnvironmentFilter)
        private readonly pythonEnvFilter: PythonEnvironmentFilter,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(JupyterConnection) private readonly jupyterConnection: JupyterConnection
    ) {}
    public async selectLocalKernel(
        notebook: NotebookDocument,
        kind: ContributedKernelFinderKind.LocalKernelSpec | ContributedKernelFinderKind.LocalPythonEnvironment
    ): Promise<LocalKernelConnectionMetadata | undefined> {
        // Reject if it's not our type
        if (notebook.notebookType !== JupyterNotebookView && notebook.notebookType !== InteractiveWindowView) {
            return;
        }
        this.localDisposables.forEach((d) => d.dispose());
        this.localDisposables = [];
        this.cancellationTokenSource?.cancel();
        this.cancellationTokenSource?.dispose();

        this.cancellationTokenSource = new CancellationTokenSource();
        const multiStep = this.multiStepFactory.create<MultiStepResult>();
        const state: MultiStepResult = { disposables: [], notebook };
        const kernelFinder = this.kernelFinder.registered.find((finder) => finder.id === kind)!;
        try {
            const result = await multiStep.run(
                this.selectKernelFromKernelFinder.bind(
                    this,
                    kernelFinder,
                    this.cancellationTokenSource.token,
                    multiStep,
                    state
                ),
                state
            );
            if (result === InputFlowAction.cancel || state.selection?.type === 'userPerformedSomeOtherAction') {
                throw new CancellationError();
            }
            if (this.cancellationTokenSource.token.isCancellationRequested) {
                disposeAllDisposables(state.disposables);
                return;
            }

            // If we got both parts of the equation, then perform the kernel source and kernel switch
            if (state.source && state.selection?.type === 'connection') {
                return state.selection.connection as LocalKernelConnectionMetadata;
            }
        } finally {
            disposeAllDisposables(state.disposables);
        }
    }
    private selectKernelFromKernelFinder(
        source: IContributedKernelFinder<KernelConnectionMetadata>,
        token: CancellationToken,
        multiStep: IMultiStepInput<MultiStepResult>,
        state: MultiStepResult
    ) {
        state.source = source;
        const provider = new QuickPickKernelItemProvider(
            state.notebook,
            source.kind,
            source,
            this.pythonEnvFilter,
            this.jupyterConnection
        );
        state.disposables.push(provider);
        return this.selectKernel(provider, token, multiStep, state);
    }
    /**
     * Second stage of the multistep to pick a kernel
     */
    private async selectKernel(
        provider: IQuickPickKernelItemProvider,
        token: CancellationToken,
        multiStep: IMultiStepInput<MultiStepResult>,
        state: MultiStepResult
    ): Promise<InputStep<MultiStepResult> | void> {
        if (token.isCancellationRequested) {
            return;
        }
        const selector = new LocalKernelSelector(this.workspace, state.notebook, provider, token);
        state.disposables.push(selector);
        const quickPickFactory: CreateAndSelectItemFromQuickPick = (options) => {
            const { quickPick, selection } = multiStep.showLazyLoadQuickPick({
                ...options,
                placeholder: '',
                matchOnDescription: true,
                matchOnDetail: true,
                supportBackInFirstStep: true,
                activeItem: undefined,
                ignoreFocusOut: false
            });
            return { quickPick, selection: selection as Promise<ConnectionQuickPickItem | QuickPickItem> };
        };
        const result = await selector.selectKernel(quickPickFactory);
        if (result?.selection === 'controller') {
            state.source = result.finder;
            state.selection = { type: 'connection', connection: result.connection };
        } else if (result?.selection === 'userPerformedSomeOtherAction') {
            state.selection = { type: 'userPerformedSomeOtherAction' };
        }
    }
}
