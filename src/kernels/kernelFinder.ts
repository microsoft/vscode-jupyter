// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Disposable, Event, EventEmitter } from 'vscode';
import { IDisposable, IDisposableRegistry } from '../platform/common/types';
import { ContributedKernelFinderKind, IContributedKernelFinder } from './internalTypes';
import { IKernelFinder, KernelConnectionMetadata } from './types';
import { DisposableBase, DisposableStore } from '../platform/common/utils/lifecycle';

/**
 * Generic class for finding kernels (both remote and local). Handles all of the caching of the results.
 */
@injectable()
export class KernelFinder extends DisposableBase implements IKernelFinder {
    private readonly _onDidChangeRegistrations = this._register(
        new EventEmitter<{
            added: IContributedKernelFinder[];
            removed: IContributedKernelFinder[];
        }>()
    );
    onDidChangeRegistrations = this._onDidChangeRegistrations.event;
    private _finders: IContributedKernelFinder<KernelConnectionMetadata>[] = [];
    private connectionFinderMapping: Map<string, IContributedKernelFinder> = new Map<
        string,
        IContributedKernelFinder
    >();

    private _onDidChangeKernels = this._register(new EventEmitter<void>());
    onDidChangeKernels: Event<void> = this._onDidChangeKernels.event;
    private _status: 'idle' | 'discovering' = 'idle';
    public get status() {
        return this._status;
    }
    public set status(value) {
        if (this._status != value) {
            this._status = value;
            this._onDidChangeStatus.fire();
        }
    }
    private readonly _onDidChangeStatus = this._register(new EventEmitter<void>());
    public get onDidChangeStatus(): Event<void> {
        return this._onDidChangeStatus.event;
    }
    constructor(@inject(IDisposableRegistry) disposables: IDisposableRegistry) {
        super();
        disposables.push(this);
        this._register(this._onDidChangeStatus);
        this._register(this._onDidChangeRegistrations);
    }

    public registerKernelFinder(finder: IContributedKernelFinder<KernelConnectionMetadata>): IDisposable {
        this._finders.push(finder);
        const updateStatus = () => {
            // If all finders are idle, then we are idle.
            this.status = this._finders.every((f) => f.status === 'idle') ? 'idle' : 'discovering';
        };

        updateStatus();
        const disposables = this._register(new DisposableStore());

        const disposeKernel = () => {
            const removeIndex = this._finders.findIndex((listFinder) => listFinder === finder);
            if (removeIndex >= 0) {
                this._finders.splice(removeIndex, 1);
            }
            disposables.dispose();
            updateStatus();

            // Notify that kernels have changed
            this._onDidChangeKernels.fire();
            this._onDidChangeRegistrations.fire({ added: [], removed: [finder] });
        };

        disposables.add(finder.onDidChangeStatus(updateStatus, this));
        disposables.add(finder.onDidChangeKernels(() => this._onDidChangeKernels.fire()));
        disposables.add(finder.onDidDispose(() => disposeKernel()));

        // Registering a new kernel finder should notify of possible kernel changes
        this._onDidChangeKernels.fire();
        this._onDidChangeRegistrations.fire({ added: [finder], removed: [] });

        // Register a disposable so kernel finders can remove themselves from the list if they are disposed
        return new Disposable(() => disposeKernel());
    }

    public get kernels(): KernelConnectionMetadata[] {
        const kernels: KernelConnectionMetadata[] = [];

        // List kernels might be called after finders or connections are removed so just clear out and regenerate
        this.connectionFinderMapping.clear();
        const loadedKernelSpecFiles = new Set<string>();
        // If we have a global kernel spec returned by Python kernel finder,
        // give that preference over the same kernel found using local kernel spec finder.
        // This is because the python kernel finder would have more information about the kernel (such as the matching python env).
        this._finders
            .filter((finder) => finder.kind === ContributedKernelFinderKind.LocalPythonEnvironment)
            .forEach((finder) => {
                // Add our connection => finder mapping
                finder.kernels.forEach((connection) => {
                    if (
                        (connection.kind === 'startUsingLocalKernelSpec' ||
                            connection.kind === 'startUsingPythonInterpreter') &&
                        connection.kernelSpec.specFile
                    ) {
                        loadedKernelSpecFiles.add(connection.kernelSpec.specFile);
                    }
                    kernels.push(connection);
                    this.connectionFinderMapping.set(connection.id, finder);
                });
            });
        this._finders
            .filter((finder) => finder.kind === ContributedKernelFinderKind.LocalKernelSpec)
            .forEach((finder) => {
                // Add our connection => finder mapping
                finder.kernels.forEach((connection) => {
                    if (
                        (connection.kind === 'startUsingLocalKernelSpec' ||
                            connection.kind === 'startUsingPythonInterpreter') &&
                        connection.kernelSpec.specFile &&
                        loadedKernelSpecFiles.has(connection.kernelSpec.specFile)
                    ) {
                        return;
                    }
                    kernels.push(connection);
                    this.connectionFinderMapping.set(connection.id, finder);
                });
            });

        const remoteFinders = this._finders.filter((finder) => finder.kind === ContributedKernelFinderKind.Remote);
        for (const finder of remoteFinders) {
            const contributedKernels = finder.kernels;

            // Add our connection => finder mapping
            contributedKernels.forEach((connection) => {
                this.connectionFinderMapping.set(connection.id, finder);
            });

            kernels.push(...contributedKernels);
        }

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
