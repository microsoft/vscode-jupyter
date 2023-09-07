// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { CancellationError, CancellationTokenSource, EventEmitter, NotebookDocument, Uri } from 'vscode';
import { ContributedKernelFinderKind, IContributedKernelFinder } from '../../../kernels/internalTypes';
import { IKernelFinder, KernelConnectionMetadata, PythonKernelConnectionMetadata } from '../../../kernels/types';
import { dispose } from '../../../platform/common/helpers';
import { IDisposable, IDisposableRegistry } from '../../../platform/common/types';
import { PythonEnvironmentFilter } from '../../../platform/interpreter/filter/filterService';
import { DataScience } from '../../../platform/common/utils/localize';
import { PromiseMonitor } from '../../../platform/common/utils/promises';
import { Disposables } from '../../../platform/common/utils';
import { JupyterPaths } from '../../../kernels/raw/finder/jupyterPaths.node';
import { IPythonApiProvider, IPythonExtensionChecker } from '../../../platform/api/types';
import { pythonEnvToJupyterEnv } from '../../../platform/api/pythonApi';
import { createInterpreterKernelSpec, getKernelId } from '../../../kernels/helpers';
import { Environment } from '@vscode/python-extension';
import { noop } from '../../../platform/common/utils/misc';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { KernelFinder } from '../../../kernels/kernelFinder';
import { LocalPythonKernelSelector } from './localPythonKernelSelector.node';
import { InputFlowAction } from '../../../platform/common/utils/multiStepInput';
import { ILocalPythonNotebookKernelSourceSelector } from '../types';

export type MultiStepResult<T extends KernelConnectionMetadata = KernelConnectionMetadata> = {
    notebook: NotebookDocument;
    selection?: { type: 'connection'; connection: T } | { type: 'userPerformedSomeOtherAction' };
    disposables: IDisposable[];
};

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
        removed?: { id: string }[];
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
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IPythonApiProvider) private readonly pythonApi: IPythonApiProvider,
        @inject(PythonEnvironmentFilter) private readonly filter: PythonEnvironmentFilter,
        @inject(JupyterPaths) private readonly jupyterPaths: JupyterPaths,
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
    public async selectLocalKernel(notebook: NotebookDocument): Promise<PythonKernelConnectionMetadata | undefined> {
        const cancellationTokenSource = new CancellationTokenSource();
        const disposables: IDisposable[] = [cancellationTokenSource];
        try {
            // eslint-disable-next-line @typescript-eslint/no-use-before-define
            const selector = new LocalPythonKernelSelector(notebook, cancellationTokenSource.token);
            disposables.push(selector);
            const kernel = await selector.selectKernel();
            if (kernel instanceof Error) {
                if (kernel instanceof InputFlowAction && kernel === InputFlowAction.back) {
                    return;
                }
                throw new CancellationError();
            }
            // Ensure this is added to the list of kernels.
            this.addUpdateKernel(kernel);
            return kernel;
        } finally {
            dispose(disposables);
        }
    }
    private addUpdateKernel(kernel: PythonKernelConnectionMetadata) {
        const existing = this._kernels.get(kernel.id);
        if (existing) {
            existing.updateInterpreter(kernel.interpreter);
            this._kernels.set(kernel.id, Object.assign(existing, kernel));
            this._onDidChangeKernels.fire({});
        } else {
            this._kernels.set(kernel.id, kernel);
            this._onDidChangeKernels.fire({});
        }
    }

    public async refresh() {
        this.previousCancellationTokens.forEach((t) => t.cancel());
        dispose(this.previousCancellationTokens);
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
            existingInterpreterInfo.updateInterpreter(result.interpreter);
            this._kernels.set(e.id, Object.assign(existingInterpreterInfo, result));
            this._onDidChangeKernels.fire({});
        } else {
            this._kernels.set(e.id, result);
            this._onDidChangeKernels.fire({});
        }
    }
}
