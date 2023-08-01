// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import {
    CancellationError,
    CancellationTokenSource,
    Disposable,
    EventEmitter,
    NotebookDocument,
    QuickInputButtons,
    Uri,
    window
} from 'vscode';
import { ContributedKernelFinderKind, IContributedKernelFinder } from '../../../kernels/internalTypes';
import { IKernelFinder, PythonKernelConnectionMetadata } from '../../../kernels/types';
import { IWorkspaceService } from '../../../platform/common/application/types';
import { InteractiveWindowView, JupyterNotebookView } from '../../../platform/common/constants';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { IDisposable, IDisposableRegistry } from '../../../platform/common/types';
import { InputFlowAction } from '../../../platform/common/utils/multiStepInput';
import { PythonEnvironmentFilter } from '../../../platform/interpreter/filter/filterService';
import { ILocalPythonNotebookKernelSourceSelector } from '../types';
import { QuickPickKernelItemProvider } from './quickPickKernelItemProvider';
import { JupyterConnection } from '../../../kernels/jupyter/connection/jupyterConnection';
import { LocalKernelSelector } from './localKernelSelector.node';
import { CompoundQuickPickItem, CreateAndSelectItemFromQuickPick } from './baseKernelSelector';
import { DataScience } from '../../../platform/common/utils/localize';
import { PromiseMonitor } from '../../../platform/common/utils/promises';
import { Disposables } from '../../../platform/common/utils';
import { JupyterPaths } from '../../../kernels/raw/finder/jupyterPaths.node';
import { IPythonApiProvider, IPythonExtensionChecker } from '../../../platform/api/types';
import { pythonEnvToJupyterEnv } from '../../../platform/api/pythonApi';
import { createInterpreterKernelSpec, getKernelId } from '../../../kernels/helpers';
import { Environment } from '../../../platform/api/pythonApiTypes';
import { noop } from '../../../platform/common/utils/misc';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { KernelFinder } from '../../../kernels/kernelFinder';
import { createDeferred } from '../../../platform/common/utils/async';

// Provides the UI to select a Kernel Source for a given notebook document
@injectable()
export class LocalPythonEnvNotebookKernelSourceSelector
    extends Disposables
    implements
        ILocalPythonNotebookKernelSourceSelector,
        IContributedKernelFinder<PythonKernelConnectionMetadata>,
        IExtensionSyncActivationService
{
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
        @inject(PythonEnvironmentFilter)
        private readonly pythonEnvFilter: PythonEnvironmentFilter,

        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(JupyterConnection) private readonly jupyterConnection: JupyterConnection,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IPythonApiProvider) private readonly pythonApi: IPythonApiProvider,
        @inject(PythonEnvironmentFilter) private readonly filter: PythonEnvironmentFilter,
        @inject(JupyterPaths) private readonly jupyterPaths: JupyterPaths,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(IPythonExtensionChecker) private readonly checker: IPythonExtensionChecker,
        @inject(IKernelFinder) kernelFinder: KernelFinder
    ) {
        super();
        disposables.push(this);
        this.disposables.push(this._onDidChangeKernels);
        this.disposables.push(this._onDidChangeStatus);
        kernelFinder.registerKernelFinder(this);
    }
    activate() {
        this.promiseMonitor.onStateChange(
            () => (this.status = this.promiseMonitor.isComplete ? 'idle' : 'discovering'),
            this,
            this.disposables
        );
        if (this.checker.isPythonExtensionInstalled) {
            this.getKernelSpecsDir().catch(noop);
            this.hookupPythonApi().catch(noop);
        } else {
            this.checker.onPythonExtensionInstallationStatusChanged(
                () => {
                    if (this.checker.isPythonExtensionInstalled) {
                        this.getKernelSpecsDir().catch(noop);
                        this.hookupPythonApi().catch(noop);
                    }
                },
                this,
                this.disposables
            );
        }
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
                api.environments.known.forEach((e) => this.buildDummyEnvironment(e).catch(noop));
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
        const cancellationTokenSource = new CancellationTokenSource();
        const disposables: IDisposable[] = [];
        disposables.push(new Disposable(() => cancellationTokenSource.cancel()));
        disposables.push(cancellationTokenSource);
        try {
            const provider = new QuickPickKernelItemProvider(
                notebook,
                this.kind,
                this,
                this.pythonEnvFilter,
                this.jupyterConnection
            );
            const selector = new LocalKernelSelector(this.workspace, notebook, provider, cancellationTokenSource.token);
            disposables.push(selector);
            disposables.push(provider);

            const quickPick = window.createQuickPick();
            disposables.push(quickPick);
            quickPick.matchOnDescription = true;
            quickPick.matchOnDetail = true;
            quickPick.ignoreFocusOut = false;
            quickPick.buttons = [QuickInputButtons.Back];
            quickPick.show();

            const selection = createDeferred<CompoundQuickPickItem>();
            const navigation = createDeferred<CompoundQuickPickItem>();
            quickPick.onDidChangeSelection((e) => (e.length ? selection.resolve(e[0]) : undefined));
            quickPick.onDidHide(() => navigation.reject(new CancellationError()));
            quickPick.onDidTriggerButton((e) => {
                if (e === QuickInputButtons.Back) {
                    navigation.reject(InputFlowAction.back);
                }
            });

            const quickPickFactory: CreateAndSelectItemFromQuickPick = (options) => {
                quickPick.title = options.title;
                quickPick.buttons = quickPick.buttons.concat(options.buttons);
                quickPick.onDidTriggerButton((e) => options.onDidTriggerButton(e));
                quickPick.items = options.items;
                return { quickPick, selection: selection.promise };
            };

            const result = await Promise.race([selector.selectKernel(quickPickFactory), navigation.promise]);
            if (!result || ('selection' in result && result.selection === 'userPerformedSomeOtherAction')) {
                // User hit cancel button (old code paths).
                throw new CancellationError();
            }
            if (!('connection' in result)) {
                // Invalid selection.
                throw new CancellationError();
            }

            // Resolve the Python environment.
            const interpreterUri = result.connection.interpreter?.uri;
            if (!interpreterUri) {
                return;
            }
            const interpreter = await this.interpreterService.getInterpreterDetails(interpreterUri);
            if (!interpreter || this.filter.isPythonEnvironmentExcluded(interpreter)) {
                return;
            }
            const spec = await createInterpreterKernelSpec(interpreter, await this.getKernelSpecsDir());
            const connection = PythonKernelConnectionMetadata.create({
                kernelSpec: spec,
                interpreter: interpreter,
                id: getKernelId(spec, interpreter)
            });
            return connection as PythonKernelConnectionMetadata;
        } catch (e) {
            if (e instanceof CancellationError || e === InputFlowAction.cancel) {
                throw new CancellationError();
            }
            if (e === InputFlowAction.back) {
                return;
            }
            throw e;
        } finally {
            disposeAllDisposables(disposables);
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
}
