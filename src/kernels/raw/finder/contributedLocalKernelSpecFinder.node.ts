// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { EventEmitter, extensions } from 'vscode';
import { IKernelFinder, LocalKernelConnectionMetadata } from '../../types';
import { LocalKnownPathKernelSpecFinder } from './localKnownPathKernelSpecFinder.node';
import { errorDecorator, logger } from '../../../platform/logging';
import { IDisposableRegistry } from '../../../platform/common/types';
import { areObjectsWithUrisTheSame } from '../../../platform/common/utils/misc';
import { KernelFinder } from '../../kernelFinder';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { DataScience } from '../../../platform/common/utils/localize';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { ContributedKernelFinderKind, IContributedKernelFinder } from '../../internalTypes';
import { PYTHON_LANGUAGE } from '../../../platform/common/constants';
import { PromiseMonitor } from '../../../platform/common/utils/promises';
import { getKernelRegistrationInfo, isUserRegisteredKernelSpecConnection } from '../../helpers';
import { createDeferred, Deferred } from '../../../platform/common/utils/async';
import { ILocalKernelFinder } from './localKernelSpecFinderBase.node';
import { LocalPythonAndRelatedNonPythonKernelSpecFinder } from './localPythonAndRelatedNonPythonKernelSpecFinder.node';
import { ObservableDisposable } from '../../../platform/common/utils/lifecycle';

// This class searches for local kernels.
// First it searches on a global persistent state, then on the installed python interpreters,
// and finally on the default locations that jupyter installs kernels on.
@injectable()
export class ContributedLocalKernelSpecFinder
    extends ObservableDisposable
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
        removed?: { id: string }[];
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
        @inject(IInterpreterService) private readonly interpreters: IInterpreterService
    ) {
        super();
        this.disposables.push(this);
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

        this.updateCache();
        let combinedProgress: Deferred<void> | undefined = undefined;
        const updateCombinedStatus = () => {
            const latestStatus: (typeof this.nonPythonKernelFinder.status)[] = [
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
        this.updateCache();
        this.interpreters.onDidChangeInterpreters(this.updateCache, this, this.disposables);
        extensions.onDidChange(
            () => {
                // If we just installed the Python extension and we fetched the controllers, then fetch it again.
                if (
                    !this.wasPythonInstalledWhenFetchingControllers &&
                    this.extensionChecker.isPythonExtensionInstalled
                ) {
                    this.updateCache();
                }
            },
            this,
            this.disposables
        );
        this.nonPythonKernelFinder.onDidChangeKernels(this.updateCache, this, this.disposables);
        this.pythonKernelFinder.onDidChangeKernels(this.updateCache, this, this.disposables);
        this.wasPythonInstalledWhenFetchingControllers = this.extensionChecker.isPythonExtensionInstalled;
    }

    public async refresh() {
        const promise = (async () => {
            await this.nonPythonKernelFinder.refresh();
            await this.pythonKernelFinder.refresh();
            this.updateCache();
        })();
        this.promiseMonitor.push(promise);
        await promise;
    }

    @errorDecorator('List kernels failed')
    private updateCache() {
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
            const kernelSpecsFromPythonKernelFinder = this.pythonKernelFinder.kernels.filter((item) =>
                isUserRegisteredKernelSpecConnection(item)
            ) as LocalKernelConnectionMetadata[];
            kernels = kernels.concat(kernelSpecs).concat(kernelSpecsFromPythonKernelFinder);
            this.writeToCache(kernels);
        } catch (ex) {
            logger.error('Exception Saving loaded kernels', ex);
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
    private writeToCache(values: LocalKernelConnectionMetadata[]) {
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
        const kernels = new Map(values.map((item) => [item.id, item]));
        const added = values.filter((k) => !oldKernels.has(k.id));
        const updated = values.filter(
            (k) => oldKernels.has(k.id) && !areObjectsWithUrisTheSame(k, oldKernels.get(k.id))
        );
        const removed = oldValues.filter((k) => !kernels.has(k.id));

        this.cache = values;
        if (added.length || updated.length || removed.length) {
            this._onDidChangeKernels.fire({ removed });
        }
    }
}
