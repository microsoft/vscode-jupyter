// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { Event, EventEmitter } from 'vscode';
import { IKernelFinder, PythonKernelConnectionMetadata } from '../../../kernels/types';
import { LocalPythonAndRelatedNonPythonKernelSpecFinder } from './localPythonAndRelatedNonPythonKernelSpecFinder.node';
import { traceDecoratorError, traceError } from '../../../platform/logging';
import { IDisposableRegistry, IExtensions } from '../../../platform/common/types';
import { capturePerfTelemetry, Telemetry } from '../../../telemetry';
import { areObjectsWithUrisTheSame, noop } from '../../../platform/common/utils/misc';
import { KernelFinder } from '../../kernelFinder';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import * as localize from '../../../platform/common/utils/localize';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { ContributedKernelFinderKind, IContributedKernelFinder } from '../../internalTypes';
import { createDeferred, Deferred } from '../../../platform/common/utils/async';
import { PromiseMonitor } from '../../../platform/common/utils/promises';

// This class searches for local kernels.
// First it searches on a global persistent state, then on the installed python interpreters,
// and finally on the default locations that jupyter installs kernels on.
@injectable()
export class ContributedLocalPythonEnvFinder
    implements IContributedKernelFinder<PythonKernelConnectionMetadata>, IExtensionSyncActivationService
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
    kind = ContributedKernelFinderKind.LocalPythonEnvironment;
    id: string = ContributedKernelFinderKind.LocalPythonEnvironment;
    displayName: string = localize.DataScience.localPythonEnvironments();

    private _onDidChangeKernels = new EventEmitter<void>();
    onDidChangeKernels: Event<void> = this._onDidChangeKernels.event;

    private wasPythonInstalledWhenFetchingControllers = false;

    private cache: PythonKernelConnectionMetadata[] = [];

    constructor(
        @inject(LocalPythonAndRelatedNonPythonKernelSpecFinder)
        private readonly pythonKernelFinder: LocalPythonAndRelatedNonPythonKernelSpecFinder,
        @inject(IKernelFinder) kernelFinder: KernelFinder,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IInterpreterService) private readonly interpreters: IInterpreterService,
        @inject(IExtensions) private readonly extensions: IExtensions
    ) {
        kernelFinder.registerKernelFinder(this);
        this.disposables.push(this.promiseMonitor);
    }

    activate() {
        this.promiseMonitor.onStateChange(() => {
            this.status = this.promiseMonitor.isComplete ? 'idle' : 'discovering';
        });
        this.refresh().then(noop, noop);
        let deferred: Deferred<void> | undefined = undefined;
        this.interpreters.onDidChangeStatus(() => {
            if (this.interpreters.status === 'idle') {
                deferred?.resolve();
                deferred = undefined;
            } else if (this.interpreters.status === 'refreshing') {
                deferred?.resolve();
                deferred = createDeferred<void>();
                this.promiseMonitor.push(deferred.promise);
            }
        });
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
        this.pythonKernelFinder.onDidChangeKernels(() => this.refresh().then(noop, noop), this, this.disposables);
        this.wasPythonInstalledWhenFetchingControllers = this.extensionChecker.isPythonExtensionInstalled;
    }

    private async refresh() {
        const promise = this.updateCache();
        this.promiseMonitor.push(promise);
        await promise;
    }

    @traceDecoratorError('List kernels failed')
    @capturePerfTelemetry(Telemetry.KernelListingPerf, { kind: 'localPython' })
    private async updateCache() {
        try {
            const pythonKernels = this.pythonKernelFinder.kernels.filter(
                (item) => item.kind === 'startUsingPythonInterpreter'
            ) as PythonKernelConnectionMetadata[];
            await this.writeToCache(pythonKernels);
        } catch (ex) {
            traceError('Exception Saving loaded kernels', ex);
        }
    }

    public get kernels(): PythonKernelConnectionMetadata[] {
        return this.cache;
    }
    private async writeToCache(values: PythonKernelConnectionMetadata[]) {
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
            this.cache = uniqueKernels;
            if (areObjectsWithUrisTheSame(oldValues, this.cache)) {
                return;
            }

            this._onDidChangeKernels.fire();
        } catch (ex) {
            traceError('LocalKernelFinder: Failed to write to cache', ex);
        }
    }
}
