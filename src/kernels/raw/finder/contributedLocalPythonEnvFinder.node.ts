// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { EventEmitter } from 'vscode';
import { IKernelFinder, LocalKernelConnectionMetadata, PythonKernelConnectionMetadata } from '../../../kernels/types';
import { traceDecoratorError, traceError, traceVerbose } from '../../../platform/logging';
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
import { getKernelRegistrationInfo } from '../../helpers';
import { ILocalKernelFinder } from './localKernelSpecFinderBase.node';
import { LocalPythonAndRelatedNonPythonKernelSpecFinder } from './localPythonAndRelatedNonPythonKernelSpecFinder.node';

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
    displayName: string = localize.DataScience.localPythonEnvironments;

    private _onDidChangeKernels = new EventEmitter<{
        added?: PythonKernelConnectionMetadata[];
        updated?: PythonKernelConnectionMetadata[];
        removed?: PythonKernelConnectionMetadata[];
    }>();
    onDidChangeKernels = this._onDidChangeKernels.event;

    private wasPythonInstalledWhenFetchingControllers = false;

    private cache: PythonKernelConnectionMetadata[] = [];
    constructor(
        @inject(LocalPythonAndRelatedNonPythonKernelSpecFinder)
        private readonly pythonKernelFinder: ILocalKernelFinder<LocalKernelConnectionMetadata>,
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
            this.status =
                this.promiseMonitor.isComplete &&
                this.interpreters.status === 'idle' &&
                this.pythonKernelFinder.status === 'idle'
                    ? 'idle'
                    : 'discovering';
        });
        this.loadData().then(noop, noop);
        let combinedProgress: Deferred<void> | undefined = undefined;
        const updateCombinedStatus = () => {
            const latestStatus: typeof this.pythonKernelFinder.status[] = [
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
        this.pythonKernelFinder.onDidChangeStatus(updateCombinedStatus, this, this.disposables);
        this.interpreters.onDidChangeStatus(updateCombinedStatus, this, this.disposables);
        this.interpreters.onDidChangeInterpreters(
            async () => {
                traceVerbose(`loadData after detecting changes to interpreters`);
                this.loadData().then(noop, noop);
            },
            this,
            this.disposables
        );
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
        this.pythonKernelFinder.onDidChangeKernels(() => this.loadData().then(noop, noop), this, this.disposables);
        this.wasPythonInstalledWhenFetchingControllers = this.extensionChecker.isPythonExtensionInstalled;
    }

    public refresh() {
        const promise = (async () => {
            await this.pythonKernelFinder.refresh();
            await this.updateCache();
        })();
        this.promiseMonitor.push(promise);
        return promise;
    }

    private loadData() {
        const promise = this.updateCache();
        this.promiseMonitor.push(promise);
        return promise;
    }

    @traceDecoratorError('List kernels failed')
    @capturePerfTelemetry(Telemetry.KernelListingPerf, { kind: 'localPython' })
    private async updateCache() {
        try {
            const pythonKernels = this.pythonKernelFinder.kernels.filter(
                (item) =>
                    item.kind === 'startUsingPythonInterpreter' &&
                    // Exclude kernel Specs that are in a non-global directory
                    getKernelRegistrationInfo(item.kernelSpec) !== 'registeredByNewVersionOfExtForCustomKernelSpec'
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
            const uniqueIds = new Set<string>();
            values = values.filter((item) => {
                if (uniqueIds.has(item.id)) {
                    return false;
                }
                uniqueIds.add(item.id);
                return true;
            });

            const oldValues = this.cache;
            const oldKernels = new Map(oldValues.map((item) => [item.id, item]));
            const newKernelIds = new Set(values.map((item) => item.id));
            const added = values.filter((k) => !oldKernels.has(k.id));
            const updated = values.filter(
                (k) => oldKernels.has(k.id) && !areObjectsWithUrisTheSame(k, oldKernels.get(k.id))
            );
            const removed = oldValues.filter((k) => !newKernelIds.has(k.id));

            this.cache = values;
            if (added.length || updated.length || removed.length) {
                this._onDidChangeKernels.fire({ added, updated, removed });
            }
            traceVerbose(
                `Updating cache with Python kernels ${values
                    .map((k) => `${k.kind}:'${k.id} (interpreter id = ${k.interpreter?.id})'`)
                    .join(', ')}\n, Added = ${added
                    .map((k) => `${k.kind}:'${k.id} (interpreter id = ${k.interpreter?.id})'`)
                    .join(', ')}\n, Updated = ${updated
                    .map((k) => `${k.kind}:'${k.id} (interpreter id = ${k.interpreter?.id})'`)
                    .join(', ')}\n, Removed = ${removed
                    .map((k) => `${k.kind}:'${k.id} (interpreter id = ${k.interpreter?.id})'`)
                    .join(', ')}`
            );
        } catch (ex) {
            traceError('LocalKernelFinder: Failed to write to cache', ex);
        }
    }
}
