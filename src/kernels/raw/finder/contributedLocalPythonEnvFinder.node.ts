// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { Event, EventEmitter } from 'vscode';
import { IKernelFinder, PythonKernelConnectionMetadata } from '../../../kernels/types';
import { LocalPythonAndRelatedNonPythonKernelSpecFinder } from './localPythonAndRelatedNonPythonKernelSpecFinder.node';
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

// This class searches for local kernels.
// First it searches on a global persistent state, then on the installed python interpreters,
// and finally on the default locations that jupyter installs kernels on.
@injectable()
export class ContributedLocalPythonEnvFinder
    implements IContributedKernelFinder<PythonKernelConnectionMetadata>, IExtensionSyncActivationService
{
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
    }

    activate() {
        this.loadInitialState().then(noop, noop);

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
        this.pythonKernelFinder.onDidChangeKernels(() => this.updateCache().then(noop, noop), this, this.disposables);
        this.wasPythonInstalledWhenFetchingControllers = this.extensionChecker.isPythonExtensionInstalled;
    }

    private async loadInitialState() {
        traceVerbose('LocalKernelFinder: load initial set of kernels');
        await this.updateCache();
        traceVerbose('LocalKernelFinder: loaded initial set of kernels');
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
