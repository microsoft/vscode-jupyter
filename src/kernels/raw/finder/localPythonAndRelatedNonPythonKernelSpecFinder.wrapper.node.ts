// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { LocalKernelConnectionMetadata } from '../../../kernels/types';
import { IDisposable, IDisposableRegistry, IFeaturesManager, KernelPickerType } from '../../../platform/common/types';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { LocalPythonAndRelatedNonPythonKernelSpecFinderOld } from './localPythonAndRelatedNonPythonKernelSpecFinder.old.node';
import { ServiceContainer } from '../../../platform/ioc/container';
import { LocalPythonAndRelatedNonPythonKernelSpecFinder } from './localPythonAndRelatedNonPythonKernelSpecFinder.node';
import { ILocalKernelFinder } from './localKernelSpecFinderBase.node';
import { EventEmitter } from 'vscode';
import { disposeAllDisposables } from '../../../platform/common/helpers';

/**
 * Returns all Python kernels and any related kernels registered in the python environment.
 * If Python extension is not installed, this will return all Python kernels registered globally.
 * If Python extension is installed,
 *     - This will return Python kernels registered by us in global locations.
 *     - This will return Python interpreters that can be started as kernels.
 *     - This will return any non-python kernels that are registered in Python environments (e.g. Java kernels within a conda environment)
 */
@injectable()
export class LocalPythonAndRelatedNonPythonKernelSpecFinderWrapper
    implements IExtensionSyncActivationService, ILocalKernelFinder<LocalKernelConnectionMetadata>
{
    private readonly disposables: IDisposable[] = [];
    private readonly finderDisposables: IDisposable[] = [];
    private previousKernelType?: KernelPickerType;
    private kernelFinder?:
        | LocalPythonAndRelatedNonPythonKernelSpecFinderOld
        | LocalPythonAndRelatedNonPythonKernelSpecFinder;
    constructor(
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IFeaturesManager) private readonly featuresManager: IFeaturesManager
    ) {
        disposables.push(this);
        this.disposables.push(this._onDidChangeStatus);
        featuresManager.onDidChangeFeatures(this.initializeFinder, this, this.disposables);
    }
    get status() {
        return this.kernelFinder?.status || 'idle';
    }
    private readonly _onDidChangeStatus = new EventEmitter<void>();
    onDidChangeStatus = this._onDidChangeStatus.event;
    private readonly _onDidChangeKernels = new EventEmitter<void>();
    onDidChangeKernels = this._onDidChangeKernels.event;
    refresh(): Promise<void> {
        throw new Error('Method not implemented.');
    }
    public activate() {
        this.initializeFinder();
    }
    public get kernels(): LocalKernelConnectionMetadata[] {
        return this.kernelFinder?.kernels ?? [];
    }
    private initializeFinder() {
        if (this.previousKernelType === this.featuresManager.features.kernelPickerType && this.kernelFinder) {
            return;
        }
        disposeAllDisposables(this.finderDisposables);
        this.previousKernelType = this.featuresManager.features.kernelPickerType;
        this.kernelFinder =
            this.previousKernelType === 'Insiders'
                ? ServiceContainer.instance.get<LocalPythonAndRelatedNonPythonKernelSpecFinder>(
                      LocalPythonAndRelatedNonPythonKernelSpecFinder
                  )
                : ServiceContainer.instance.get<LocalPythonAndRelatedNonPythonKernelSpecFinderOld>(
                      LocalPythonAndRelatedNonPythonKernelSpecFinderOld
                  );
        this.kernelFinder.onDidChangeKernels(() => this._onDidChangeKernels.fire(), this, this.finderDisposables);
        this.kernelFinder.onDidChangeStatus(() => this._onDidChangeStatus.fire(), this, this.finderDisposables);
        this.finderDisposables.push(this.kernelFinder);
    }
    public dispose() {
        this._onDidChangeStatus.dispose();
        disposeAllDisposables(this.disposables);
        disposeAllDisposables(this.finderDisposables);
    }
}
