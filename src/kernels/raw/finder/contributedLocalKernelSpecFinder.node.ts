// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { Event, EventEmitter } from 'vscode';
import { IKernelFinder, LocalKernelConnectionMetadata } from '../../types';
import { LocalPythonAndRelatedNonPythonKernelSpecFinder } from './localPythonAndRelatedNonPythonKernelSpecFinder.node';
import { LocalKnownPathKernelSpecFinder } from './localKnownPathKernelSpecFinder.node';
import { traceInfo, traceDecoratorError, traceError } from '../../../platform/logging';
import { IDisposableRegistry, IExtensions, IFeaturesManager } from '../../../platform/common/types';
import { capturePerfTelemetry, Telemetry } from '../../../telemetry';
import { areObjectsWithUrisTheSame, noop } from '../../../platform/common/utils/misc';
import { KernelFinder } from '../../kernelFinder';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { DataScience } from '../../../platform/common/utils/localize';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { ContributedKernelFinderKind, IContributedKernelFinder } from '../../internalTypes';
import { PYTHON_LANGUAGE } from '../../../platform/common/constants';
import { PromiseMonitor } from '../../../platform/common/utils/promises';
import { getKernelRegistrationInfo } from '../../helpers';
import { createDeferred, Deferred } from '../../../platform/common/utils/async';

// This class searches for local kernels.
// First it searches on a global persistent state, then on the installed python interpreters,
// and finally on the default locations that jupyter installs kernels on.
@injectable()
export class ContributedLocalKernelSpecFinder
    implements IContributedKernelFinder<LocalKernelConnectionMetadata>, IExtensionSyncActivationService
{
    private _status: 'discovering' | 'idle' = 'idle';
    public get status() {
        return this._status;
    }
    private set status(value: typeof this._status) {
        if (this._status === value) {
            return;
        }
        this._status = value;
        this._onDidChangeStatus.fire();
    }
    private readonly _onDidChangeStatus = new EventEmitter<void>();
    public readonly onDidChangeStatus = this._onDidChangeStatus.event;
    private readonly promiseMonitor = new PromiseMonitor();

    kind = ContributedKernelFinderKind.LocalKernelSpec;
    id: string = ContributedKernelFinderKind.LocalKernelSpec;
    displayName: string = DataScience.localKernelSpecs();

    private _onDidChangeKernels = new EventEmitter<void>();
    onDidChangeKernels: Event<void> = this._onDidChangeKernels.event;

    private wasPythonInstalledWhenFetchingControllers = false;

    private cache: LocalKernelConnectionMetadata[] = [];

    constructor(
        @inject(LocalKnownPathKernelSpecFinder) private readonly nonPythonKernelFinder: LocalKnownPathKernelSpecFinder,
        @inject(LocalPythonAndRelatedNonPythonKernelSpecFinder)
        private readonly pythonKernelFinder: LocalPythonAndRelatedNonPythonKernelSpecFinder,
        @inject(IKernelFinder) kernelFinder: KernelFinder,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IInterpreterService) private readonly interpreters: IInterpreterService,
        @inject(IExtensions) private readonly extensions: IExtensions,
        @inject(IFeaturesManager) private readonly featureManager: IFeaturesManager
    ) {
        kernelFinder.registerKernelFinder(this);
        this.disposables.push(this._onDidChangeStatus);
        this.disposables.push(this._onDidChangeKernels);
        this.disposables.push(this.promiseMonitor);
    }

    activate() {
        this.promiseMonitor.onStateChange(() => {
            this.status =
                this.promiseMonitor.isComplete &&
                this.interpreters.status === 'idle' &&
                this.nonPythonKernelFinder.status === 'idle' &&
                this.pythonKernelFinder.status === 'idle'
                    ? 'idle'
                    : 'discovering';
        });

        this.loadData().then(noop, noop);
        let combinedProgress: Deferred<void> | undefined = undefined;
        const updateCombinedStatus = () => {
            const latestStatus: typeof this.nonPythonKernelFinder.status[] = [
                this.nonPythonKernelFinder.status,
                this.pythonKernelFinder.status,
                this.interpreters.status === 'refreshing' ? 'discovering' : 'idle'
            ];
            if (latestStatus.includes('discovering')) {
                if (!combinedProgress) {
                    combinedProgress = createDeferred<void>();
                    this.promiseMonitor.push(combinedProgress.promise);
                }
            } else {
                combinedProgress?.resolve();
                combinedProgress = undefined;
            }
        };
        updateCombinedStatus();
        this.nonPythonKernelFinder.onDidChangeStatus(updateCombinedStatus, this, this.disposables);
        this.pythonKernelFinder.onDidChangeStatus(updateCombinedStatus, this, this.disposables);
        this.interpreters.onDidChangeStatus(updateCombinedStatus, this, this.disposables);
        this.loadData().then(noop, noop);
        this.interpreters.onDidChangeInterpreters(async () => this.loadData().then(noop, noop), this, this.disposables);
        this.extensions.onDidChange(
            () => {
                // If we just installed the Python extension and we fetched the controllers, then fetch it again.
                if (
                    !this.wasPythonInstalledWhenFetchingControllers &&
                    this.extensionChecker.isPythonExtensionInstalled
                ) {
                    this.loadData().then(noop, noop);
                }
            },
            this,
            this.disposables
        );
        this.nonPythonKernelFinder.onDidChangeKernels(() => this.loadData().then(noop, noop), this, this.disposables);
        this.pythonKernelFinder.onDidChangeKernels(() => this.loadData().then(noop, noop), this, this.disposables);
        this.wasPythonInstalledWhenFetchingControllers = this.extensionChecker.isPythonExtensionInstalled;
    }

    public async refresh() {
        const promise = (async () => {
            await this.nonPythonKernelFinder.refresh();
            await this.pythonKernelFinder.refresh();
            await this.updateCache();
        })();
        this.promiseMonitor.push(promise);
        await promise;
    }

    private async loadData() {
        const promise = this.updateCache();
        this.promiseMonitor.push(promise);
        await promise;
    }

    @traceDecoratorError('List kernels failed')
    @capturePerfTelemetry(Telemetry.KernelListingPerf, { kind: 'localKernelSpec' })
    private async updateCache() {
        try {
            let kernels: LocalKernelConnectionMetadata[] = [];
            // Exclude python kernel specs (we'll get that from the pythonKernelFinder)
            const kernelSpecs = this.nonPythonKernelFinder.kernels.filter((item) => {
                if (this.extensionChecker.isPythonExtensionInstalled) {
                    return item.kernelSpec.language !== PYTHON_LANGUAGE;
                }
                return true;
            });
            const kernelSpecsFromPythonKernelFinder = this.pythonKernelFinder.kernels.filter(
                (item) =>
                    item.kind === 'startUsingLocalKernelSpec' ||
                    (item.kind === 'startUsingPythonInterpreter' &&
                        // Also include kernel Specs that are in a non-global directory.
                        getKernelRegistrationInfo(item.kernelSpec) === 'registeredByNewVersionOfExtForCustomKernelSpec')
            ) as LocalKernelConnectionMetadata[];
            kernels = kernels.concat(kernelSpecs).concat(kernelSpecsFromPythonKernelFinder);
            await this.writeToCache(kernels);
        } catch (ex) {
            traceError('Exception Saving loaded kernels', ex);
        }
    }

    public get kernels(): LocalKernelConnectionMetadata[] {
        if (this.featureManager.features.kernelPickerType === 'Insiders') {
            const loadedKernelSpecFiles = new Set<string>();
            const kernels: LocalKernelConnectionMetadata[] = [];
            // If we have a global kernel spec returned by Python kernel finder,
            // give that preference over the same kernel found using local kernel spec finder.
            // This is because the python kernel finder would have more information about the kernel (such as the matching python env).
            this.pythonKernelFinder.kernels.forEach((connection) => {
                const kernelSpecKind = getKernelRegistrationInfo(connection.kernelSpec);
                if (
                    connection.kernelSpec.specFile &&
                    kernelSpecKind === 'registeredByNewVersionOfExtForCustomKernelSpec'
                ) {
                    loadedKernelSpecFiles.add(connection.kernelSpec.specFile);
                    kernels.push(connection);
                }
            });
            this.cache.forEach((connection) => {
                if (connection.kernelSpec.specFile && loadedKernelSpecFiles.has(connection.kernelSpec.specFile)) {
                    return;
                }
                kernels.push(connection);
            });
            return kernels;
        } else {
            return this.cache;
        }
    }
    private filterKernels(kernels: LocalKernelConnectionMetadata[]) {
        return kernels.filter(({ kernelSpec }) => {
            if (!kernelSpec) {
                return true;
            }
            // Disable xeus python for now.
            if (kernelSpec.argv[0].toLowerCase().endsWith('xpython')) {
                traceInfo(`Hiding xeus kernelspec`);
                return false;
            }

            return true;
        });
    }

    private async writeToCache(values: LocalKernelConnectionMetadata[]) {
        try {
            const oldValues = this.cache;
            const uniqueIds = new Set<string>();
            const uniqueKernels = values.filter((item) => {
                if (uniqueIds.has(item.id)) {
                    return false;
                }
                uniqueIds.add(item.id);
                return true;
            });
            this.cache = this.filterKernels(uniqueKernels);
            if (oldValues.length === this.cache.length && areObjectsWithUrisTheSame(oldValues, this.cache)) {
                return;
            }

            this._onDidChangeKernels.fire();
        } catch (ex) {
            traceError('LocalKernelFinder: Failed to write to cache', ex);
        }
    }
}
