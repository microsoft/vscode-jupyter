// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EventEmitter, Uri } from 'vscode';
import { Disposables } from '../../../platform/common/utils';
import { ContributedKernelFinderKind } from '../../internalTypes';
import { IKernelFinder, PythonKernelConnectionMetadata } from '../../types';
import { IDisposableRegistry } from '../../../platform/common/types';
import { inject, injectable } from 'inversify';
import { PythonEnvironmentQuickPickItemProvider } from '../../../platform/interpreter/pythonEnvironmentQuickPickProvider.node';
import { Environment, ProposedExtensionAPI } from '../../../platform/api/pythonApiTypes';
import { pythonEnvToJupyterEnv } from '../../../platform/api/pythonApi';
import { IPythonApiProvider, IPythonExtensionChecker } from '../../../platform/api/types';
import { createDeferred } from '../../../platform/common/utils/async';
import { noop } from '../../../platform/common/utils/misc';
import { traceError } from '../../../platform/logging';
import { JupyterPaths } from './jupyterPaths.node';
import { createInterpreterKernelSpec, getKernelId } from '../../helpers';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { DataScience } from '../../../platform/common/utils/localize';
import { PromiseMonitor } from '../../../platform/common/utils/promises';
import { swallowExceptions } from '../../../platform/common/utils/decorators';
import { IPythonKernelFinder } from '../../jupyter/types';
import { PythonEnvironmentFilter } from '../../../platform/interpreter/filter/filterService';

@injectable()
export class LocalPythonKernelFinder
    extends Disposables
    implements IPythonKernelFinder, IExtensionSyncActivationService
{
    get status(): 'discovering' | 'idle' {
        return this.promiseMonitor.isComplete && this.pythonEnvQuickPickProvider.status === 'idle'
            ? 'idle'
            : 'discovering';
    }
    private _onDidChangeStatus = new EventEmitter<void>();
    onDidChangeStatus = this._onDidChangeStatus.event;
    private _onDidChangeKernels = new EventEmitter<{
        removed?:
            | {
                  id: string;
              }[]
            | undefined;
    }>();
    onDidChangeKernels = this._onDidChangeKernels.event;
    lastError?: Error | undefined;
    id: string = ContributedKernelFinderKind.LocalPythonEnvironment;
    displayName: string = DataScience.localPythonEnvironments;
    kind: ContributedKernelFinderKind = ContributedKernelFinderKind.LocalPythonEnvironment;
    private readonly pythonApi = createDeferred<ProposedExtensionAPI>();
    private api?: ProposedExtensionAPI;
    private kernelConnections = new Map<string, PythonKernelConnectionMetadata>();
    private kernelConnectionPromises = new Map<string, Promise<PythonKernelConnectionMetadata>>();
    private tempDirForKernelSpecs = createDeferred<Uri>();
    private readonly promiseMonitor = new PromiseMonitor();
    private readonly pythonEnvQuickPickProvider: PythonEnvironmentQuickPickItemProvider;
    get kernels(): PythonKernelConnectionMetadata[] {
        return Array.from(this.kernelConnections.values());
    }
    private get environments() {
        return this.api ? this.api.environments.known : [];
    }
    constructor(
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(PythonEnvironmentQuickPickItemProvider)
        pythonEnvQuickPickProvider: PythonEnvironmentQuickPickItemProvider,
        @inject(IPythonExtensionChecker) private readonly pythonExtensionChecker: IPythonExtensionChecker,
        @inject(IPythonApiProvider) private readonly pythonApiProvider: IPythonApiProvider,
        @inject(JupyterPaths) private readonly jupyterPaths: JupyterPaths,
        @inject(IKernelFinder) kernelFinder: IKernelFinder,
        @inject(PythonEnvironmentFilter) private readonly filter: PythonEnvironmentFilter
    ) {
        super();
        disposables.push(this);
        this.disposables.push(this._onDidChangeKernels);
        this.disposables.push(this._onDidChangeStatus);
        this.disposables.push(this.promiseMonitor);
        this.pythonEnvQuickPickProvider = pythonEnvQuickPickProvider.withFilter(
            (item) => !this.filter.isPythonEnvironmentExcluded(item)
        );
        this.pythonEnvQuickPickProvider.onDidChangeStatus(() => this._onDidChangeStatus.fire(), this, this.disposables);
        this.promiseMonitor.onStateChange(() => this._onDidChangeStatus.fire(), this, this.disposables);
        this.filter.onDidChange(this.onDidChangeFilter, this, this.disposables);
        kernelFinder.registerKernelFinder(this);
        if (this.pythonExtensionChecker.isPythonExtensionInstalled) {
            this.getPythonApi().catch(noop);
        } else {
            this.pythonExtensionChecker.onPythonExtensionInstallationStatusChanged(
                this.getPythonApi,
                this,
                this.disposables
            );
        }
        this.pythonEnvQuickPickProvider.onDidChange(this.buildKernelConnections, this, this.disposables);
    }
    activate() {
        this.jupyterPaths
            .getKernelSpecTempRegistrationFolder()
            .then((uri) => this.tempDirForKernelSpecs.resolve(uri))
            .catch((ex) => {
                traceError('Failed to get temp dir for kernelspecs', ex);
                return Promise.reject(ex);
            });
    }
    public getOrCreateKernelConnection(env: Environment): Promise<PythonKernelConnectionMetadata> {
        return this.getOrCreateKernelConnectionImpl(env, true);
    }
    private onDidChangeFilter() {
        const removedItems = new Set<string>();
        Array.from(this.kernelConnections.values())
            .filter((item) => this.filter.isPythonEnvironmentExcluded(item.interpreter))
            .forEach((item) => {
                this.kernelConnectionPromises.delete(item.interpreter.id);
                this.kernelConnections.delete(item.interpreter.id);
                removedItems.add(item.interpreter.id);
            });
        if (removedItems.size > 0) {
            const removed = Array.from(removedItems).map((id) => ({ id }));
            this._onDidChangeKernels.fire({ removed });
        }

        // Perhaps some have been added back.
        this.buildKernelConnections();
    }
    @swallowExceptions('Failed to get Python API')
    private async getPythonApi() {
        if (!this.pythonExtensionChecker.isPythonExtensionInstalled) {
            return;
        }
        try {
            const api = await this.pythonApiProvider.getNewApi();
            if (!api) {
                return;
            }
            this.pythonApi.resolve(api);
            this.api = api;
            this.buildKernelConnections();
            api.environments.onDidChangeEnvironments(
                (e) => {
                    if (e.type === 'remove') {
                        this.kernelConnectionPromises.delete(e.env.id);
                        if (this.kernelConnections.has(e.env.id)) {
                            this.kernelConnections.delete(e.env.id);
                            this._onDidChangeKernels.fire({ removed: [{ id: e.env.id }] });
                        }
                    }
                },
                this,
                this.disposables
            );
        } catch (ex) {
            traceError('Failed to get Python API', ex);
        }
    }
    private buildKernelConnections() {
        this.environments
            .filter((env) => !this.kernelConnectionPromises.has(env.id) && !this.kernelConnections.has(env.id))
            .forEach((env) => this.getOrCreateKernelConnectionImpl(env, false).catch(noop));
    }
    private getOrCreateKernelConnectionImpl(
        env: Environment,
        resolveEnvironmentIfNecessary: boolean
    ): Promise<PythonKernelConnectionMetadata> {
        const connection = this.kernelConnections.get(env.id);
        if (connection) {
            return Promise.resolve(connection);
        }
        const promise = (async () => {
            let interpreter = pythonEnvToJupyterEnv(env, true);
            if (!interpreter && resolveEnvironmentIfNecessary) {
                const resolveEnv = await this.pythonApi.promise.then((api) => api.environments.resolveEnvironment(env));
                if (!resolveEnv) {
                    throw new Error(`Failed to resolve environment ${env.id}`);
                }
                interpreter = pythonEnvToJupyterEnv(resolveEnv, true);
            }
            if (!interpreter) {
                throw new Error(
                    `Failed to resolve environment and get interpreter details for Kernel Connection ${env.id}`
                );
            }
            const spec = await createInterpreterKernelSpec(interpreter, await this.tempDirForKernelSpecs.promise);
            const result = PythonKernelConnectionMetadata.create({
                kernelSpec: spec,
                interpreter: interpreter,
                id: getKernelId(spec, interpreter)
            });
            this.kernelConnections.set(env.id, result);
            this._onDidChangeKernels.fire({});
            return result;
        })();
        promise.catch((ex) => {
            if (this.kernelConnectionPromises.get(env.id) === promise) {
                traceError(`Failed to get Kernel Connection for ${env.id}`, ex);
                this.kernelConnectionPromises.delete(env.id);
            }
        });
        this.promiseMonitor.push(promise);
        this.kernelConnectionPromises.set(env.id, promise);
        return promise;
    }
    async refresh(): Promise<void> {
        this.kernelConnectionPromises.clear();
        await this.pythonEnvQuickPickProvider.refresh();
    }
}
