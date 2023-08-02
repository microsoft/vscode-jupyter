// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EventEmitter, workspace } from 'vscode';
import { injectable, inject } from 'inversify';
import { IQuickPickItemProvider, SelectorQuickPickItem } from '../common/providerBasedQuickPick';
import { Environment, ProposedExtensionAPI } from '../api/pythonApiTypes';
import { IExtensionSyncActivationService } from '../activation/types';
import { IDisposable } from '../common/types';
import { PromiseMonitor } from '../common/utils/promises';
import { IPythonApiProvider } from '../api/types';
import { PythonEnvironmentFilter } from './filter/filterService';
import { traceError } from '../logging';
import { getEnvironmentType, getPythonEnvDisplayName, isCondaEnvironmentWithoutPython } from './helpers';
import { getDisplayPath } from '../common/platform/fs-paths';
import { PlatformService } from '../common/platform/platformService.node';
import { DataScience } from '../common/utils/localize';
import { EnvironmentType } from '../pythonEnvironments/info';
import { noop } from '../common/utils/misc';

@injectable()
export class PythonEnvironmentQuickPickItemProvider
    implements IQuickPickItemProvider<Environment>, IExtensionSyncActivationService
{
    title: string = DataScience.selectPythonEnvironmentTitle;
    private _onDidChange = new EventEmitter<void>();
    private _onDidFail = new EventEmitter<Error>();
    private _onDidChangeStatus = new EventEmitter<void>();
    private _onDidChangeRecommended = new EventEmitter<void>();
    private _onDidChangeSelected = new EventEmitter<void>();
    onDidChange = this._onDidChange.event;
    onDidFail = this._onDidFail.event;
    onDidChangeStatus = this._onDidChangeStatus.event;
    onDidChangeRecommended = this._onDidChangeRecommended.event;
    onDidChangeSelected = this._onDidChangeSelected.event;

    private refreshedOnceBefore = false;
    recommended?: Environment | undefined;
    selected?: Environment | undefined;
    private api?: ProposedExtensionAPI;
    private readonly disposables: IDisposable[] = [];
    private readonly promiseMonitor = new PromiseMonitor();
    public get items(): Environment[] {
        if (!this.api) {
            return [];
        }
        if (!this.refreshedOnceBefore) {
            this.refreshedOnceBefore = true;
            this.refresh().catch(noop);
        }
        return this.api.environments.known.filter((item) => !this.filter.isPythonEnvironmentExcluded(item));
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
        @inject(PythonEnvironmentFilter) private readonly filter: PythonEnvironmentFilter
    ) {
        this.promiseMonitor.onStateChange(
            () => (this.status = this.promiseMonitor.isComplete ? 'idle' : 'discovering'),
            this,
            this.disposables
        );
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
    }
    activate(): void {
        // Ensure we resolve the Python API ASAP.
        // This makes the api.environments.known available soon, hence improving over all
        // perceived performance for the user.
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
    isRecommended(_item: Environment): boolean {
        return false;
    }
    isSelected(_item: Environment): boolean {
        return false;
    }
    toQuickPick(item: Environment): SelectorQuickPickItem<Environment> {
        const label = getPythonEnvDisplayName(item);
        const recommended = this.isRecommended(item);
        const icon = recommended ? ' $(star-full) ' : isCondaEnvironmentWithoutPython(item) ? '$(warning) ' : '';
        const quickPick = new SelectorQuickPickItem(`${icon}${label}`, item);
        quickPick.description = getDisplayPath(
            item.executable.uri || item.path,
            workspace.workspaceFolders || [],
            new PlatformService().homeDir
        );
        quickPick.tooltip = isCondaEnvironmentWithoutPython(item) ? DataScience.pythonCondaKernelsWithoutPython : '';
        return quickPick;
    }
    getCategory(item: Environment): { label: string; sortKey?: string } {
        switch (getEnvironmentType(item)) {
            case EnvironmentType.Conda:
                return isCondaEnvironmentWithoutPython(item)
                    ? { label: DataScience.kernelCategoryForCondaWithoutPython, sortKey: 'Z' }
                    : { label: DataScience.kernelCategoryForConda };
            case EnvironmentType.Pipenv:
                return { label: DataScience.kernelCategoryForPipEnv };
            case EnvironmentType.Poetry:
                return { label: DataScience.kernelCategoryForPoetry };
            case EnvironmentType.Pyenv:
                return { label: DataScience.kernelCategoryForPyEnv };
            case EnvironmentType.Venv:
            case EnvironmentType.VirtualEnv:
            case EnvironmentType.VirtualEnvWrapper:
                return { label: DataScience.kernelCategoryForVirtual };
            default:
                return { label: DataScience.kernelCategoryForGlobal };
        }
    }
}
