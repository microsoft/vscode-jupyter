// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { EventEmitter } from 'vscode';
import { IKernelFinder, LocalKernelConnectionMetadata } from '../../types';
import { LocalKnownPathKernelSpecFinder } from './localKnownPathKernelSpecFinder.node';
import { traceInfo, traceDecoratorError, traceError, traceVerbose } from '../../../platform/logging';
import { IDisposableRegistry, IExtensions } from '../../../platform/common/types';
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
import { ILocalKernelFinder } from './localKernelSpecFinderBase.node';
import { LocalPythonAndRelatedNonPythonKernelSpecFinder } from './localPythonAndRelatedNonPythonKernelSpecFinder.node';

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
    displayName: string = DataScience.localKernelSpecs;

    private _onDidChangeKernels = new EventEmitter<{
        added?: LocalKernelConnectionMetadata[];
        updated?: LocalKernelConnectionMetadata[];
        removed?: LocalKernelConnectionMetadata[];
    }>();
    onDidChangeKernels = this._onDidChangeKernels.event;

    private wasPythonInstalledWhenFetchingControllers = false;

    private cache: LocalKernelConnectionMetadata[] = [];
    constructor(
        @inject(LocalKnownPathKernelSpecFinder) private readonly nonPythonKernelFinder: LocalKnownPathKernelSpecFinder,
        @inject(LocalPythonAndRelatedNonPythonKernelSpecFinder)
        private readonly pythonKernelFinder: ILocalKernelFinder<LocalKernelConnectionMetadata>,
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
    private async updateCache() {
        try {
            let kernels: LocalKernelConnectionMetadata[] = [];
            // Exclude python kernel specs (we'll get that from the pythonKernelFinder)
            const kernelSpecs = this.nonPythonKernelFinder.kernels.filter((item) => {
                // Remove this condition.
                // https://github.com/microsoft/vscode-jupyter/issues/12278
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
        const loadedKernelSpecFiles = new Set<string>();
        const kernels: LocalKernelConnectionMetadata[] = [];
        // If we have a global kernel spec returned by Python kernel finder,
        // give that preference over the same kernel found using local kernel spec finder.
        // This is because the python kernel finder would have more information about the kernel (such as the matching python env).
        this.pythonKernelFinder.kernels.forEach((connection) => {
            const kernelSpecKind = getKernelRegistrationInfo(connection.kernelSpec);
            if (connection.kernelSpec.specFile && kernelSpecKind === 'registeredByNewVersionOfExtForCustomKernelSpec') {
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
            const uniqueIds = new Set<string>();
            values = this.filterKernels(
                values.filter((item) => {
                    if (uniqueIds.has(item.id)) {
                        return false;
                    }
                    uniqueIds.add(item.id);
                    return true;
                })
            );

            const oldValues = this.cache;
            const oldKernels = new Map(oldValues.map((item) => [item.id, item]));
            const kernels = new Map(values.map((item) => [item.id, item]));
            const added = values.filter((k) => !oldKernels.has(k.id));
            const updated = values.filter(
                (k) => oldKernels.has(k.id) && !areObjectsWithUrisTheSame(k, oldKernels.get(k.id))
            );
            const removed = oldValues.filter((k) => !kernels.has(k.id));

            this.cache = values;
            if (added.length || updated.length || removed.length) {
                this._onDidChangeKernels.fire({ added, updated, removed });
            }

            if (values.length) {
                traceVerbose(
                    `Updating cache with Local kernels ${values
                        .map((k) => `${k.kind}:'${k.id} (interpreter id = ${k.interpreter?.id})'`)
                        .join(', ')}, Added = ${added
                        .map((k) => `${k.kind}:'${k.id} (interpreter id = ${k.interpreter?.id})'`)
                        .join(', ')}, Updated = ${updated
                        .map((k) => `${k.kind}:'${k.id} (interpreter id = ${k.interpreter?.id})'`)
                        .join(', ')}, Removed = ${removed
                        .map((k) => `${k.kind}:'${k.id} (interpreter id = ${k.interpreter?.id})'`)
                        .join(', ')}`
                );
            }
        } catch (ex) {
            traceError('LocalKernelFinder: Failed to write to cache', ex);
        }
    }
}
