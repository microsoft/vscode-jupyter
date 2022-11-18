// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Event, EventEmitter } from 'vscode';
import { IDisposable, IDisposableRegistry } from '../platform/common/types';
import { traceInfoIfCI } from '../platform/logging';
import { IContributedKernelFinder } from './internalTypes';
import { IKernelFinder, KernelConnectionMetadata } from './types';

/**
 * Generic class for finding kernels (both remote and local). Handles all of the caching of the results.
 */
@injectable()
export class KernelFinder implements IKernelFinder {
    private readonly _onDidChangeRegistrations = new EventEmitter<{
        added: IContributedKernelFinder[];
        removed: IContributedKernelFinder[];
    }>();
    onDidChangeRegistrations = this._onDidChangeRegistrations.event;
    private _finders: IContributedKernelFinder<KernelConnectionMetadata>[] = [];
    private connectionFinderMapping: Map<string, IContributedKernelFinder> = new Map<
        string,
        IContributedKernelFinder
    >();

    private _onDidChangeKernels = new EventEmitter<void>();
    onDidChangeKernels: Event<void> = this._onDidChangeKernels.event;
    private _status: 'idle' | 'discovering';
    public get status() {
        return this._status;
    }
    public set status(value) {
        if (this._status != value) {
            this._status = value;
            this._onDidChangeStatus.fire();
        }
    }
    private readonly _onDidChangeStatus = new EventEmitter<void>();
    public get onDidChangeStatus(): Event<void> {
        return this._onDidChangeStatus.event;
    }
    constructor(@inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry) {
        disposables.push(this._onDidChangeStatus);
        disposables.push(this._onDidChangeRegistrations);
    }

    public registerKernelFinder(finder: IContributedKernelFinder<KernelConnectionMetadata>): IDisposable {
        this._finders.push(finder);
        const statusChange = finder.onDidChangeStatus(() => (this.status = finder.status), this, this.disposables);
        const onDidChangeDisposable = finder.onDidChangeKernels(() => this._onDidChangeKernels.fire());
        this.disposables.push(onDidChangeDisposable);

        // Registering a new kernel finder should notify of possible kernel changes
        this._onDidChangeKernels.fire();
        this._onDidChangeRegistrations.fire({ added: [finder], removed: [] });
        // Register a disposable so kernel finders can remove themselves from the list if they are disposed
        return {
            dispose: () => {
                const removeIndex = this._finders.findIndex((listFinder) => {
                    return listFinder === finder;
                });
                this._finders.splice(removeIndex, 1);
                onDidChangeDisposable.dispose();
                statusChange.dispose();

                // Notify that kernels have changed
                this._onDidChangeKernels.fire();
                this._onDidChangeRegistrations.fire({ added: [], removed: [finder] });
            }
        };
    }

    public get kernels(): KernelConnectionMetadata[] {
        const kernels: KernelConnectionMetadata[] = [];

        // List kernels might be called after finders or connections are removed so just clear out and regenerate
        this.connectionFinderMapping.clear();

        for (const finder of this._finders) {
            const contributedKernels = finder.kernels;

            // Add our connection => finder mapping
            contributedKernels.forEach((connection) => {
                this.connectionFinderMapping.set(connection.id, finder);
            });

            kernels.push(...contributedKernels);
        }

        traceInfoIfCI(
            `list kernel specs ${kernels.length}: ${kernels
                .map((i) => `${i.id}, ${i.kind}, ${i.interpreter?.uri}`)
                .join('\n')}`
        );

        return kernels;
    }

    // Check our mappings to see what connection supplies this metadata, since metadatas can be created outside of finders
    // allow for undefined as a return value
    public getFinderForConnection(kernelMetadata: KernelConnectionMetadata): IContributedKernelFinder | undefined {
        return this.connectionFinderMapping.get(kernelMetadata.id);
    }

    // Give the info for what kernel finders are currently registered
    public get registered(): IContributedKernelFinder[] {
        return this._finders;
    }
}
