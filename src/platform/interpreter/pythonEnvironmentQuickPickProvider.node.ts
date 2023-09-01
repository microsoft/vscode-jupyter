// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EventEmitter } from 'vscode';
import { injectable, inject } from 'inversify';
import { IQuickPickItemProvider } from '../common/providerBasedQuickPick';
import { Environment, ProposedExtensionAPI } from '../api/pythonApiTypes';
import { IExtensionSyncActivationService } from '../activation/types';
import { IDisposable, IDisposableRegistry } from '../common/types';
import { PromiseMonitor } from '../common/utils/promises';
import { IPythonApiProvider, IPythonExtensionChecker } from '../api/types';
import { traceError } from '../logging';
import { DataScience } from '../common/utils/localize';
import { noop } from '../common/utils/misc';
import { dispose } from '../common/helpers';

@injectable()
export class PythonEnvironmentQuickPickItemProvider
    implements IQuickPickItemProvider<Environment>, IExtensionSyncActivationService
{
    title: string = DataScience.quickPickSelectPythonEnvironmentTitle;
    private _onDidChange = new EventEmitter<void>();
    private _onDidChangeStatus = new EventEmitter<void>();
    onDidChange = this._onDidChange.event;
    onDidChangeStatus = this._onDidChangeStatus.event;
    private refreshedOnceBefore = false;
    private api?: ProposedExtensionAPI;
    private readonly disposables: IDisposable[] = [];
    private readonly promiseMonitor = new PromiseMonitor();
    public get items(): readonly Environment[] {
        if (!this.api) {
            return [];
        }
        if (!this.refreshedOnceBefore) {
            this.refreshedOnceBefore = true;
            this.refresh().catch(noop);
        }
        return this.api.environments.known;
    }
    private _status: 'idle' | 'discovering' = 'idle';
    public get status() {
        return this._status;
    }
    private set status(value: typeof this._status) {
        this._status = value;
        this._onDidChangeStatus.fire();
    }
    constructor(
        @inject(IPythonApiProvider) api: IPythonApiProvider,
        @inject(IPythonExtensionChecker) extensionChecker: IPythonExtensionChecker,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry
    ) {
        disposables.push(this);
        this.promiseMonitor.onStateChange(
            () => (this.status = this.promiseMonitor.isComplete ? 'idle' : 'discovering'),
            this,
            this.disposables
        );
        const initializeApi = () => {
            const apiPromise = api.getNewApi();
            this.promiseMonitor.push(apiPromise);
            apiPromise
                .then((api?: ProposedExtensionAPI) => {
                    this.api = api;
                    if (!api) {
                        this.status = 'idle';
                        this._onDidChangeStatus.fire();
                        return;
                    }
                    this._onDidChange.fire();
                    api.environments.onDidChangeEnvironments(() => this._onDidChange.fire(), this, this.disposables);
                })
                .catch((ex) => traceError('Failed to get python api', ex));
        };
        if (extensionChecker.isPythonExtensionInstalled) {
            initializeApi();
        } else {
            extensionChecker.onPythonExtensionInstallationStatusChanged(
                () => {
                    if (extensionChecker.isPythonExtensionInstalled) {
                        initializeApi();
                    }
                },
                this,
                this.disposables
            );
        }
    }
    activate(): void {
        // Ensure we resolve the Python API ASAP.
        // This makes the api.environments.known available soon, hence improving over all
        // perceived performance for the user.
    }
    dispose() {
        dispose(this.disposables);
    }
    async refresh() {
        // very unlikely that we have been unable to get the Python extension api, hence no need to wait on the promise.
        if (!this.api) {
            return;
        }
        const promise = this.api.environments.refreshEnvironments();
        this.promiseMonitor.push(promise);
        await promise.catch(noop);
    }
    /**
     * Returns the same class with the ability to filer environments.
     */
    withFilter(filter: (env: Environment) => boolean): PythonEnvironmentQuickPickItemProvider {
        return new Proxy(this, {
            get(target: PythonEnvironmentQuickPickItemProvider, propKey: keyof PythonEnvironmentQuickPickItemProvider) {
                switch (propKey) {
                    case 'items':
                        return target.items.filter(filter);
                    case 'dispose':
                        // Dispose can only be called on the original instance (prevent anyone else calling this).
                        return noop;
                    default:
                        return target[propKey];
                }
            }
        });
    }
}
