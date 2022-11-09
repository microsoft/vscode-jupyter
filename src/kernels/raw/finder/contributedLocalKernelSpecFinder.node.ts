// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { Event, EventEmitter } from 'vscode';
import { IKernelFinder, LocalKernelSpecConnectionMetadata } from '../../types';
import { LocalPythonAndRelatedNonPythonKernelSpecFinder } from './localPythonAndRelatedNonPythonKernelSpecFinder.node';
import { LocalKnownPathKernelSpecFinder } from './localKnownPathKernelSpecFinder.node';
import { traceInfo, traceDecoratorError, traceError } from '../../../platform/logging';
import { IDisposableRegistry, IExtensions } from '../../../platform/common/types';
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

// This class searches for local kernels.
// First it searches on a global persistent state, then on the installed python interpreters,
// and finally on the default locations that jupyter installs kernels on.
@injectable()
export class ContributedLocalKernelSpecFinder
    implements IContributedKernelFinder<LocalKernelSpecConnectionMetadata>, IExtensionSyncActivationService
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

    private cache: LocalKernelSpecConnectionMetadata[] = [];

    constructor(
        @inject(LocalKnownPathKernelSpecFinder) private readonly nonPythonKernelFinder: LocalKnownPathKernelSpecFinder,
        @inject(LocalPythonAndRelatedNonPythonKernelSpecFinder)
        private readonly pythonKernelFinder: LocalPythonAndRelatedNonPythonKernelSpecFinder,
        @inject(IKernelFinder) kernelFinder: KernelFinder,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IInterpreterService) private readonly interpreters: IInterpreterService,
        @inject(IExtensions) private readonly extensions: IExtensions
    ) {
        kernelFinder.registerKernelFinder(this);
        this.disposables.push(this._onDidChangeStatus);
        this.disposables.push(this._onDidChangeKernels);
        this.disposables.push(this.promiseMonitor);
    }

    activate() {
        this.promiseMonitor.onStateChange(() => {
            this.status = this.promiseMonitor.isComplete ? 'idle' : 'discovering';
        });
        this.refresh().then(noop, noop);

        this.interpreters.onDidChangeInterpreters(async () => this.refresh().then(noop, noop), this, this.disposables);
        this.extensions.onDidChange(
            () => {
                // If we just installed the Python extension and we fetched the controllers, then fetch it again.
                if (
                    !this.wasPythonInstalledWhenFetchingControllers &&
                    this.extensionChecker.isPythonExtensionInstalled
                ) {
                    this.refresh().then(noop, noop);
                }
            },
            this,
            this.disposables
        );
        this.nonPythonKernelFinder.onDidChangeKernels(() => this.refresh().then(noop, noop), this, this.disposables);
        this.pythonKernelFinder.onDidChangeKernels(() => this.refresh().then(noop, noop), this, this.disposables);
        this.wasPythonInstalledWhenFetchingControllers = this.extensionChecker.isPythonExtensionInstalled;
    }

    private async refresh() {
        const promise = this.updateCache();
        this.promiseMonitor.push(promise);
        await promise;
    }

    @traceDecoratorError('List kernels failed')
    @capturePerfTelemetry(Telemetry.KernelListingPerf, { kind: 'localKernelSpec' })
    private async updateCache() {
        try {
            let kernels: LocalKernelSpecConnectionMetadata[] = [];
            // Exclude python kernel specs (we'll get that from the pythonKernelFinder)
            const kernelSpecs = this.nonPythonKernelFinder.kernels.filter((item) => {
                if (this.extensionChecker.isPythonExtensionInstalled) {
                    return item.kernelSpec.language !== PYTHON_LANGUAGE;
                }
                return true;
            });
            const kernelSpecsFromPythonKernelFinder = this.pythonKernelFinder.kernels.filter(
                (item) => item.kind === 'startUsingLocalKernelSpec'
            ) as LocalKernelSpecConnectionMetadata[];
            kernels = kernels.concat(kernelSpecs).concat(kernelSpecsFromPythonKernelFinder);
            await this.writeToCache(kernels);
        } catch (ex) {
            traceError('Exception Saving loaded kernels', ex);
            console.error('Exception Saving loaded kernels', ex);
        }
    }

    public get kernels(): LocalKernelSpecConnectionMetadata[] {
        return this.cache;
    }
    private filterKernels(kernels: LocalKernelSpecConnectionMetadata[]) {
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

    private async writeToCache(values: LocalKernelSpecConnectionMetadata[]) {
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
            if (areObjectsWithUrisTheSame(oldValues, this.cache)) {
                return;
            }

            this._onDidChangeKernels.fire();
        } catch (ex) {
            traceError('LocalKernelFinder: Failed to write to cache', ex);
        }
    }
}
