// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import {
    CancellationError,
    CancellationToken,
    CancellationTokenSource,
    EventEmitter,
    NotebookDocument,
    QuickPickItem,
    Uri
} from 'vscode';
import { ContributedKernelFinderKind, IContributedKernelFinder } from '../../../kernels/internalTypes';
import { KernelConnectionMetadata, PythonKernelConnectionMetadata } from '../../../kernels/types';
import { IWorkspaceService } from '../../../platform/common/application/types';
import { InteractiveWindowView, JupyterNotebookView } from '../../../platform/common/constants';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { Experiments, IDisposable, IDisposableRegistry, IExperimentService } from '../../../platform/common/types';
import {
    IMultiStepInput,
    IMultiStepInputFactory,
    InputFlowAction
} from '../../../platform/common/utils/multiStepInput';
import { PythonEnvironmentFilter } from '../../../platform/interpreter/filter/filterService';
import { ILocalPythonNotebookKernelSourceSelector } from '../types';
import { QuickPickKernelItemProvider } from './quickPickKernelItemProvider';
import { ConnectionQuickPickItem, MultiStepResult } from './types';
import { JupyterConnection } from '../../../kernels/jupyter/connection/jupyterConnection';
import { LocalKernelSelector } from './localKernelSelector.node';
import { CreateAndSelectItemFromQuickPick } from './baseKernelSelector';
import { DataScience } from '../../../platform/common/utils/localize';
import { PromiseMonitor } from '../../../platform/common/utils/promises';
import { Disposables } from '../../../platform/common/utils';
import { JupyterPaths } from '../../../kernels/raw/finder/jupyterPaths.node';
import { IPythonApiProvider } from '../../../platform/api/types';
import { pythonEnvToJupyterEnv, resolvedPythonEnvToJupyterEnv } from '../../../platform/api/pythonApi';
import { createInterpreterKernelSpec, getKernelId } from '../../../kernels/helpers';
import { Environment } from '../../../platform/api/pythonApiTypes';
import { noop } from '../../../platform/common/utils/misc';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';

// Provides the UI to select a Kernel Source for a given notebook document
@injectable()
export class LocalPythonEnvNotebookKernelSourceSelector
    extends Disposables
    implements
        ILocalPythonNotebookKernelSourceSelector,
        IContributedKernelFinder<PythonKernelConnectionMetadata>,
        IExtensionSyncActivationService
{
    private localDisposables: IDisposable[] = [];
    private cancellationTokenSource: CancellationTokenSource | undefined;
    kind = ContributedKernelFinderKind.LocalPythonEnvironment;
    id: string = ContributedKernelFinderKind.LocalPythonEnvironment;
    displayName: string = DataScience.localPythonEnvironments;

    private _onDidChangeKernels = new EventEmitter<{
        added?: PythonKernelConnectionMetadata[];
        updated?: PythonKernelConnectionMetadata[];
        removed?: PythonKernelConnectionMetadata[];
    }>();
    onDidChangeKernels = this._onDidChangeKernels.event;
    private _kernels = new Map<string, PythonKernelConnectionMetadata>();
    private readonly _onDidChangeStatus = new EventEmitter<void>();
    private _status: 'idle' | 'discovering' = 'idle';
    public get status() {
        return this._status;
    }
    private set status(value: typeof this._status) {
        this._status = value;
        this._onDidChangeStatus.fire();
    }
    private readonly promiseMonitor = new PromiseMonitor();
    public readonly onDidChangeStatus = this._onDidChangeStatus.event;
    public get kernels(): PythonKernelConnectionMetadata[] {
        return Array.from(this._kernels.values());
    }
    private previousCancellationTokens: CancellationTokenSource[] = [];
    private tempDirForKernelSpecs?: Promise<Uri>;
    constructor(
        @inject(IMultiStepInputFactory) private readonly multiStepFactory: IMultiStepInputFactory,
        @inject(PythonEnvironmentFilter)
        private readonly pythonEnvFilter: PythonEnvironmentFilter,

        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(JupyterConnection) private readonly jupyterConnection: JupyterConnection,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IPythonApiProvider) private readonly pythonApi: IPythonApiProvider,
        @inject(PythonEnvironmentFilter) private readonly filter: PythonEnvironmentFilter,
        @inject(JupyterPaths) private readonly jupyterPaths: JupyterPaths,
        @inject(IExperimentService) private readonly experiments: IExperimentService
    ) {
        super();
        disposables.push(this);
        this.disposables.push(this._onDidChangeKernels);
        this.disposables.push(this._onDidChangeStatus);
    }
    activate() {
        if (!this.experiments.inExperiment(Experiments.FastKernelPicker)) {
            return;
        }
        this.promiseMonitor.onStateChange(
            () => (this.status = this.promiseMonitor.isComplete ? 'idle' : 'discovering'),
            this,
            this.disposables
        );
        this.getKernelSpecsDir().catch(noop);
        this.hookupPythonApi().catch(noop);
    }
    public async refresh() {
        this.previousCancellationTokens.forEach((t) => t.cancel());
        disposeAllDisposables(this.previousCancellationTokens);
        this.previousCancellationTokens = [];
        this._kernels.clear();
        this.pythonApi
            .getNewApi()
            .then((api) => {
                if (!api) {
                    return;
                }
                this.promiseMonitor.push(api.environments.refreshEnvironments({ forceRefresh: true }).catch(noop));
                api.environments.known.forEach((e) => this.buildDummyEnvironment(e));
            })
            .catch(noop);
    }
    public async selectLocalKernel(notebook: NotebookDocument): Promise<PythonKernelConnectionMetadata | undefined> {
        // Reject if it's not our type
        if (notebook.notebookType !== JupyterNotebookView && notebook.notebookType !== InteractiveWindowView) {
            return;
        }
        this.pythonApi
            .getNewApi()
            .then((api) => {
                if (!api) {
                    return;
                }
                this.promiseMonitor.push(api.environments.refreshEnvironments().catch(noop));
            })
            .catch(noop);
        this.localDisposables.forEach((d) => d.dispose());
        this.localDisposables = [];
        this.cancellationTokenSource?.cancel();
        this.cancellationTokenSource?.dispose();

        this.cancellationTokenSource = new CancellationTokenSource();
        const multiStep = this.multiStepFactory.create<MultiStepResult>();
        const state: MultiStepResult = { disposables: [], notebook };
        try {
            const result = await multiStep.run(
                this.selectKernelFromKernelFinder.bind(
                    this,
                    this,
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
                return state.selection.connection as PythonKernelConnectionMetadata;
            }
        } finally {
            disposeAllDisposables(state.disposables);
        }
    }
    private getKernelSpecsDir() {
        return this.tempDirForKernelSpecs || this.jupyterPaths.getKernelSpecTempRegistrationFolder();
    }
    private apiHooked = false;
    private async hookupPythonApi() {
        if (this.apiHooked) {
            return;
        }
        this.apiHooked = true;
        const api = await this.pythonApi.getNewApi();
        if (!api) {
            return;
        }
        api.environments.known.map((e) => this.buildDummyEnvironment(e).catch(noop));
        api.environments.onDidChangeEnvironments(
            (e) => {
                if (e.type === 'remove') {
                    const kernel = this._kernels.get(e.env.id);
                    if (kernel) {
                        this._kernels.delete(e.env.id);
                        this._onDidChangeKernels.fire({ removed: [kernel] });
                    }
                } else {
                    this.buildDummyEnvironment(e.env).catch(noop);
                }
            },
            this,
            this.disposables
        );
    }
    private async buildDummyEnvironment(e: Environment) {
        if (!e.executable.sysPrefix || !e.executable.uri) {
            return;
        }
        const displayEmptyCondaEnv =
            this.pythonApi.pythonExtensionVersion &&
            this.pythonApi.pythonExtensionVersion.compare('2023.3.10341119') >= 0;
        const interpreter = pythonEnvToJupyterEnv(e, displayEmptyCondaEnv === true);
        if (!interpreter || this.filter.isPythonEnvironmentExcluded(interpreter)) {
            return;
        }
        const spec = await createInterpreterKernelSpec(interpreter, await this.getKernelSpecsDir());
        const result = PythonKernelConnectionMetadata.create({
            kernelSpec: spec,
            interpreter: interpreter,
            id: getKernelId(spec, interpreter)
        });

        const existingInterpreterInfo = this._kernels.get(e.id);
        if (existingInterpreterInfo) {
            this._kernels.set(e.id, Object.assign(existingInterpreterInfo, result));
            this._onDidChangeKernels.fire({ updated: [result] });
        } else {
            this._kernels.set(e.id, result);
            this._onDidChangeKernels.fire({ added: [result] });
        }
    }

    private async selectKernelFromKernelFinder(
        source: IContributedKernelFinder<KernelConnectionMetadata>,
        token: CancellationToken,
        multiStep: IMultiStepInput<MultiStepResult>,
        state: MultiStepResult
    ) {
        if (token.isCancellationRequested) {
            return;
        }
        state.source = source;
        const provider = new QuickPickKernelItemProvider(
            state.notebook,
            source.kind,
            source,
            this.pythonEnvFilter,
            this.jupyterConnection
        );
        state.disposables.push(provider);
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
            // Resolve the Python environment.
            const interpreterId = result.connection?.interpreter?.id;
            if (!interpreterId) {
                return;
            }
            const connection = await this.getKernelConnectionFromSelection(interpreterId);
            if (!connection) {
                return;
            }
            state.source = result.finder;
            state.selection = { type: 'connection', connection };
        } else if (result?.selection === 'userPerformedSomeOtherAction') {
            state.selection = { type: 'userPerformedSomeOtherAction' };
        }
    }
    private async getKernelConnectionFromSelection(pythonEnvId: string) {
        const api = await this.pythonApi.getNewApi();
        if (!api) {
            return;
        }
        const env = api.environments.known.find((e) => e.id === pythonEnvId);
        if (!env) {
            return;
        }
        const resolveEnv = await api.environments.resolveEnvironment(env);
        if (!resolveEnv) {
            return;
        }
        const displayEmptyCondaEnv =
            this.pythonApi.pythonExtensionVersion &&
            this.pythonApi.pythonExtensionVersion.compare('2023.3.10341119') >= 0;

        const interpreter = resolvedPythonEnvToJupyterEnv(resolveEnv, displayEmptyCondaEnv === true);
        if (!interpreter || this.filter.isPythonEnvironmentExcluded(interpreter)) {
            return;
        }
        const spec = await createInterpreterKernelSpec(interpreter, await this.getKernelSpecsDir());
        return PythonKernelConnectionMetadata.create({
            kernelSpec: spec,
            interpreter: interpreter,
            id: getKernelId(spec, interpreter)
        });
    }
}
