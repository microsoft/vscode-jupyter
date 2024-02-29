// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { CancellationToken, CancellationTokenSource, env, Memento } from 'vscode';
import { getKernelId } from '../../../kernels/helpers';
import { IJupyterKernelSpec, LocalKernelSpecConnectionMetadata } from '../../../kernels/types';
import { LocalKernelSpecFinderBase } from './localKernelSpecFinderBase.node';
import { JupyterPaths } from './jupyterPaths.node';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { IApplicationEnvironment } from '../../../platform/common/application/types';
import { traceError, traceVerbose, traceWarning } from '../../../platform/logging';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import { IMemento, GLOBAL_MEMENTO, IDisposableRegistry } from '../../../platform/common/types';
import { sendKernelSpecTelemetry } from './helper';
import { areObjectsWithUrisTheSame, noop } from '../../../platform/common/utils/misc';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { debounce } from '../../../platform/common/decorators';

function localKernelSpecsCacheKey() {
    const LocalKernelSpecsCacheKey = 'LOCAL_KERNEL_SPECS_CACHE_KEY_V_2023_2';
    return `${LocalKernelSpecsCacheKey}:${env.appHost}:${env.remoteName || ''}`;
}

/**
 * This class searches for kernels on the file system in well known paths documented by Jupyter.
 * This will return Python, Julia, R etc kernels.
 * Returns all kernels regardless of whether Python extension is installed or not.
 */
@injectable()
export class LocalKnownPathKernelSpecFinder
    extends LocalKernelSpecFinderBase<LocalKernelSpecConnectionMetadata>
    implements IExtensionSyncActivationService
{
    private readonly _kernels = new Map<string, LocalKernelSpecConnectionMetadata>();
    constructor(
        @inject(IFileSystemNode) fs: IFileSystemNode,
        @inject(JupyterPaths) jupyterPaths: JupyterPaths,
        @inject(IPythonExtensionChecker) extensionChecker: IPythonExtensionChecker,
        @inject(IMemento) @named(GLOBAL_MEMENTO) memento: Memento,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IApplicationEnvironment) env: IApplicationEnvironment
    ) {
        super(fs, extensionChecker, memento, disposables, env, jupyterPaths);
    }
    activate(): void {
        this.listKernelsFirstTimeFromMemento(localKernelSpecsCacheKey())
            .then((kernels) => {
                // If we found kernels even before the cache was restored, then ignore the cached data.
                if (this._kernels.size === 0 && kernels.length) {
                    kernels.forEach((k) => this._kernels.set(k.id, k));
                    this._onDidChangeKernels.fire();
                }
            })
            .catch(noop);
        this.refresh().then(noop, noop);
    }
    public get kernels(): LocalKernelSpecConnectionMetadata[] {
        return Array.from(this._kernels.values());
    }
    public dispose(): void | undefined {
        this._onDidChangeKernels.dispose();
    }
    public async refresh() {
        this.clearCache();
        await this.refreshData();
    }
    private async refreshData() {
        const cancellation = new CancellationTokenSource();
        try {
            await this.listKernelSpecs(cancellation.token);
        } finally {
            cancellation.dispose();
        }
    }
    @debounce(100)
    private writeKernelsToMemento() {
        this.writeToMementoCache(Array.from(this._kernels.values()), localKernelSpecsCacheKey());
    }
    private async listKernelSpecs(cancelToken: CancellationToken): Promise<LocalKernelSpecConnectionMetadata[]> {
        const fn = async () => {
            const newKernelSpecs = await this.findKernelSpecs(cancelToken);
            if (cancelToken.isCancellationRequested) {
                return [];
            }
            const oldSortedKernels = Array.from(this._kernels.values()).sort((a, b) => a.id.localeCompare(b.id));
            const newSortedKernels = newKernelSpecs.sort((a, b) => a.id.localeCompare(b.id));
            const newKernelIds = new Set(newKernelSpecs.map((k) => k.id));
            const deletedKernels = oldSortedKernels.filter((k) => !newKernelIds.has(k.id));

            newKernelSpecs.forEach((k) => this._kernels.set(k.id, k));
            if (deletedKernels.length) {
                traceVerbose(
                    `Local kernel spec connection deleted ${deletedKernels.map((item) => `${item.kind}:'${item.id}'`)}`
                );
                deletedKernels.forEach((k) => this._kernels.delete(k.id));
            }

            // Trigger a change event if we have different kernels.
            if (
                oldSortedKernels.length !== newSortedKernels.length ||
                deletedKernels.length ||
                JSON.stringify(oldSortedKernels) !== JSON.stringify(newSortedKernels)
            ) {
                this._onDidChangeKernels.fire();
                this.writeKernelsToMemento();
            }
            return newKernelSpecs;
        };
        const promise = fn();
        this.promiseMonitor.push(promise);
        return promise;
    }
    private async findKernelSpecs(cancelToken: CancellationToken): Promise<LocalKernelSpecConnectionMetadata[]> {
        // Find all the possible places to look for this resource
        const paths = await this.jupyterPaths.getKernelSpecRootPaths(cancelToken);
        if (cancelToken.isCancellationRequested) {
            return [];
        }
        const searchResults = await Promise.all(
            paths.map((kernelPath) => this.kernelSpecFinder.findKernelSpecsInPaths(kernelPath, cancelToken))
        );
        if (cancelToken.isCancellationRequested) {
            return [];
        }
        // Filter out duplicates. This can happen when
        // 1) Conda installs kernel
        // 2) Same kernel is registered in the global location
        // We should have extra metadata on the global location pointing to the original
        const originalSpecFiles = new Set<string>();
        // There was also an old bug where the same item would be registered more than once. Eliminate these dupes
        // too.
        const unique: LocalKernelSpecConnectionMetadata[] = [];
        const byDisplayName = new Map<string, IJupyterKernelSpec>();

        await Promise.all(
            searchResults.flat().map(async (kernelSpecFile) => {
                try {
                    // Add these into our path cache to speed up later finds
                    const kernelSpec = await this.kernelSpecFinder.loadKernelSpec(kernelSpecFile, cancelToken);
                    if (!kernelSpec || cancelToken.isCancellationRequested) {
                        return;
                    }
                    sendKernelSpecTelemetry(kernelSpec, 'local');
                    if (kernelSpec.metadata?.originalSpecFile) {
                        if (originalSpecFiles.has(kernelSpec.metadata.originalSpecFile)) {
                            return;
                        }
                        originalSpecFiles.add(kernelSpec.metadata.originalSpecFile);
                    }
                    if (kernelSpec.specFile) {
                        if (originalSpecFiles.has(kernelSpec.specFile)) {
                            return;
                        }
                        originalSpecFiles.add(kernelSpec.specFile);
                    }
                    const existing = byDisplayName.get(kernelSpec.display_name);
                    const item = LocalKernelSpecConnectionMetadata.create({
                        kernelSpec,
                        interpreter: undefined,
                        id: getKernelId(kernelSpec)
                    });
                    if (existing && existing.executable !== kernelSpec.executable) {
                        // This item is a dupe but has a different path to start the exe
                        unique.push(item);
                        if (!areObjectsWithUrisTheSame(item, this._kernels.get(item.id))) {
                            this._kernels.set(item.id, item);
                            this._onDidChangeKernels.fire();
                            this.writeKernelsToMemento();
                        }
                    } else if (!existing) {
                        unique.push(item);
                        byDisplayName.set(kernelSpec.display_name, kernelSpec);
                        if (!areObjectsWithUrisTheSame(item, this._kernels.get(item.id))) {
                            this._kernels.set(item.id, item);
                            this._onDidChangeKernels.fire();
                            this.writeKernelsToMemento();
                        }
                    } else {
                        traceWarning(
                            `Duplicate kernel found ${kernelSpec.display_name} ${kernelSpec.executable} in ${kernelSpec.specFile}`
                        );
                    }
                } catch (ex) {
                    traceError(`Failed to load kernelSpec for ${kernelSpecFile}`, ex);
                    return;
                }
            })
        );

        return unique;
    }
}
