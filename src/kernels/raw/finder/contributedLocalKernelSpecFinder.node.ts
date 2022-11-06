// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { Event, EventEmitter } from 'vscode';
import { IKernelFinder, LocalKernelSpecConnectionMetadata } from '../../types';
import { LocalPythonAndRelatedNonPythonKernelSpecFinder } from './localPythonAndRelatedNonPythonKernelSpecFinder.node';
import { LocalKnownPathKernelSpecFinder } from './localKnownPathKernelSpecFinder.node';
import { traceInfo, traceDecoratorError, traceError, traceVerbose } from '../../../platform/logging';
import { IDisposableRegistry, IExtensions } from '../../../platform/common/types';
import { capturePerfTelemetry, Telemetry } from '../../../telemetry';
import { waitForCondition } from '../../../platform/common/utils/async';
import { areObjectsWithUrisTheSame, noop } from '../../../platform/common/utils/misc';
import { KernelFinder } from '../../kernelFinder';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { CondaService } from '../../../platform/common/process/condaService.node';
import { DataScience } from '../../../platform/common/utils/localize';
import { debounceAsync } from '../../../platform/common/utils/decorators';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { ContributedKernelFinderKind, IContributedKernelFinder } from '../../internalTypes';
import { PYTHON_LANGUAGE } from '../../../platform/common/constants';
import { KnownEnvironmentTypes } from '../../../platform/api/pythonApiTypes';

// This class searches for local kernels.
// First it searches on a global persistent state, then on the installed python interpreters,
// and finally on the default locations that jupyter installs kernels on.
@injectable()
export class ContributedLocalKernelSpecFinder
    implements IContributedKernelFinder<LocalKernelSpecConnectionMetadata>, IExtensionSyncActivationService
{
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
        @inject(CondaService) private readonly condaService: CondaService,
        @inject(IExtensions) private readonly extensions: IExtensions
    ) {
        kernelFinder.registerKernelFinder(this);
    }

    activate() {
        this.loadInitialState().then(noop, noop);

        this.condaService.onCondaEnvironmentsChanged(this.onDidChangeCondaEnvironments, this, this.disposables);

        this.interpreters.onDidChangeInterpreters(
            async () => this.updateCache().then(noop, noop),
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
                    this.updateCache().then(noop, noop);
                }
            },
            this,
            this.disposables
        );
        this.nonPythonKernelFinder.onDidChangeKernels(
            () => this.updateCache().then(noop, noop),
            this,
            this.disposables
        );
        this.pythonKernelFinder.onDidChangeKernels(() => this.updateCache().then(noop, noop), this, this.disposables);
        this.wasPythonInstalledWhenFetchingControllers = this.extensionChecker.isPythonExtensionInstalled;
    }

    private async loadInitialState() {
        traceVerbose('LocalKernelFinder: load initial set of kernels');
        await this.updateCache();
        traceVerbose('LocalKernelFinder: loaded initial set of kernels');
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
        }
    }

    @debounceAsync(1_000)
    private async onDidChangeCondaEnvironments() {
        if (!this.extensionChecker.isPythonExtensionInstalled) {
            return;
        }
        // A new conda environment was added or removed, hence refresh the kernels.
        // Wait for the new env to be discovered before refreshing the kernels.
        const previousCondaEnvCount = this.interpreters.environments.filter(
            (item) => (item.environment?.type as KnownEnvironmentTypes) === 'Conda'
        ).length;

        await this.interpreters.refreshInterpreters(true).ignoreErrors();
        // Possible discovering interpreters is very quick and we've already discovered it, hence refresh kernels immediately.
        await this.updateCache();

        // Possible discovering interpreters is slow, hence try for around 10s.
        // I.e. just because we know a conda env was created doesn't necessarily mean its immediately discoverable and usable.
        // Possible it takes some time.
        // Wait for around 5s between each try, we know Python extension can be slow to discover interpreters.
        await waitForCondition(
            async () => {
                const condaEnvCount = this.interpreters.environments.filter(
                    (item) => (item.environment?.type as KnownEnvironmentTypes) === 'Conda'
                ).length;
                if (condaEnvCount > previousCondaEnvCount) {
                    return true;
                }
                await this.interpreters.refreshInterpreters(true);
                return false;
            },
            15_000,
            5000
        );

        await this.updateCache();
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
