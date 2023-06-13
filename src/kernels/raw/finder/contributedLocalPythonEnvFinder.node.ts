// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { CancellationTokenSource, EventEmitter, Uri } from 'vscode';
import { IKernelFinder, PythonKernelConnectionMetadata } from '../../../kernels/types';
import { IDisposableRegistry, IExtensionContext } from '../../../platform/common/types';
import { noop } from '../../../platform/common/utils/misc';
import { KernelFinder } from '../../kernelFinder';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import * as localize from '../../../platform/common/utils/localize';
import { IPythonApiProvider } from '../../../platform/api/types';
import { ContributedKernelFinderKind, IContributedKernelFinder } from '../../internalTypes';
import { createInterpreterKernelSpec, getKernelId } from '../../helpers';
import { JupyterPaths } from './jupyterPaths.node';
import { Disposables } from '../../../platform/common/utils';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { pythonUnResolvedEnvToJupyterEnv } from '../../../platform/api/pythonApi';
import { Environment } from '../../../platform/api/pythonApiTypes';
import { PromiseMonitor } from '../../../platform/common/utils/promises';
import { PythonEnvironmentFilter } from '../../../platform/interpreter/filter/filterService';

// This class searches for local kernels.
// First it searches on a global persistent state, then on the installed python interpreters,
// and finally on the default locations that jupyter installs kernels on.
@injectable()
export class ContributedLocalPythonEnvFinder
    extends Disposables
    implements IContributedKernelFinder<PythonKernelConnectionMetadata>, IExtensionSyncActivationService
{
    kind = ContributedKernelFinderKind.LocalPythonEnvironment;
    id: string = ContributedKernelFinderKind.LocalPythonEnvironment;
    displayName: string = localize.DataScience.localPythonEnvironments;

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
        @inject(IKernelFinder) kernelFinder: KernelFinder,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(JupyterPaths) private readonly jupyterPaths: JupyterPaths,
        @inject(IExtensionContext) private readonly context: IExtensionContext,
        @inject(IPythonApiProvider) private readonly pythonApi: IPythonApiProvider,
        @inject(PythonEnvironmentFilter) private readonly filter: PythonEnvironmentFilter
    ) {
        super();
        kernelFinder.registerKernelFinder(this);
        disposables.push(this);
    }

    private async buildEnvironment(e: Environment) {
        if (!e.executable.sysPrefix || !e.executable.uri) {
            return;
        }
        const interpreter = pythonUnResolvedEnvToJupyterEnv(e);
        if (!interpreter || this.filter.isPythonEnvironmentExcluded(interpreter)) {
            return;
        }
        const spec = await createInterpreterKernelSpec(interpreter, this.context.globalStorageUri);
        const result = PythonKernelConnectionMetadata.create({
            kernelSpec: spec,
            interpreter: interpreter,
            id: getKernelId(spec, interpreter)
        });

        const existingInterpreterInfo = this._kernels.get(result.id);
        if (existingInterpreterInfo) {
            this._kernels.set(result.id, Object.assign(existingInterpreterInfo, result));
            this._onDidChangeKernels.fire({ updated: [result] });
        } else {
            this._kernels.set(result.id, result);
            this._onDidChangeKernels.fire({ added: [result] });
        }
    }
    activate() {
        this.promiseMonitor.onStateChange(
            () => (this.status = this.promiseMonitor.isComplete ? 'idle' : 'discovering'),
            this,
            this.disposables
        );
        this.getKernelSpecTempRegistrationFolder().catch(noop);
        this.disposables.push(this._onDidChangeKernels);
        this.disposables.push(this._onDidChangeStatus);
        this.pythonApi
            .getNewApi()
            .then((api) => {
                if (!api) {
                    return;
                }
                this.promiseMonitor.push(api.environments.refreshEnvironments().catch(noop));
                api.environments.known.map((e) => this.buildEnvironment(e).catch(noop));
                api.environments.onDidChangeEnvironments(
                    async (e) => {
                        if (e.type === 'remove') {
                            const kernels = Array.from(this._kernels.values()).filter(
                                (k) => k.interpreter.id === e.env.id
                            );
                            kernels.forEach((k) => {
                                this._kernels.delete(k.id);
                                this._onDidChangeKernels.fire({ removed: [k] });
                            });
                        } else if (e.env.executable.sysPrefix && e.env.executable.uri) {
                            await this.buildEnvironment(e.env);
                        }
                    },
                    this,
                    this.disposables
                );
            })
            .catch(noop);
    }

    public override dispose(): void {
        super.dispose();
        disposeAllDisposables(this.previousCancellationTokens);
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
                api.environments.known.forEach((e) => this.buildEnvironment(e));
            })
            .catch(noop);
    }
    private async getKernelSpecTempRegistrationFolder() {
        this.tempDirForKernelSpecs =
            this.tempDirForKernelSpecs || this.jupyterPaths.getKernelSpecTempRegistrationFolder();
        return this.tempDirForKernelSpecs;
    }
}
