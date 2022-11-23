// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable, named } from 'inversify';
import { CancellationToken, CancellationTokenSource, EventEmitter, Memento } from 'vscode';
import { getKernelId } from '../../../kernels/helpers';
import { IJupyterKernelSpec, LocalKernelSpecConnectionMetadata } from '../../../kernels/types';
import { LocalKernelSpecFinderBase } from './localKernelSpecFinderBase.node';
import { JupyterPaths } from './jupyterPaths.node';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { IApplicationEnvironment, IWorkspaceService } from '../../../platform/common/application/types';
import { traceError, traceVerbose } from '../../../platform/logging';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import { IMemento, GLOBAL_MEMENTO, IDisposableRegistry } from '../../../platform/common/types';
import { capturePerfTelemetry, Telemetry } from '../../../telemetry';
import { sendKernelSpecTelemetry } from './helper';
import { noop } from '../../../platform/common/utils/misc';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';

const LocalKernelSpecsCacheKey = 'LOCAL_KERNEL_SPECS_CACHE_KEY_V_2022_10';

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
    private readonly _cachedKernels = new Map<string, LocalKernelSpecConnectionMetadata>();
    private readonly _onDidChangeKernels = new EventEmitter<void>();
    /**
     * TODO: We can monitor the known kernel spec folders and files for changes and trigger the change event.
     * Lets discuss with VS Code core if there are known perf issues.
     * If there are, then there's no need to monitor these folders/files for now.
     */
    public readonly onDidChangeKernels = this._onDidChangeKernels.event;
    constructor(
        @inject(IFileSystemNode) fs: IFileSystemNode,
        @inject(IWorkspaceService) workspaceService: IWorkspaceService,
        @inject(JupyterPaths) jupyterPaths: JupyterPaths,
        @inject(IPythonExtensionChecker) extensionChecker: IPythonExtensionChecker,
        @inject(IMemento) @named(GLOBAL_MEMENTO) memento: Memento,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IApplicationEnvironment) env: IApplicationEnvironment
    ) {
        super(fs, workspaceService, extensionChecker, memento, disposables, env, jupyterPaths);
    }
    activate(): void {
        const cancellation = new CancellationTokenSource();
        this.listKernelsFirstTimeFromMemento(LocalKernelSpecsCacheKey)
            .then((kernels) => {
                if (this._cachedKernels.size === 0 && kernels.length) {
                    kernels.forEach((k) => this._cachedKernels.set(k.id, k));
                    this._onDidChangeKernels.fire();
                }
            })
            .ignoreErrors();
        this.listKernelSpecs(cancellation.token)
            .then(noop, noop)
            .finally(() => cancellation.dispose());
    }
    public get kernels(): LocalKernelSpecConnectionMetadata[] {
        return Array.from(this._cachedKernels.values());
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
    /**
     * @param {boolean} includePythonKernels Include/exclude Python kernels in the result.
     */
    @capturePerfTelemetry(Telemetry.KernelListingPerf, { kind: 'localKernelSpec' })
    private async listKernelSpecs(cancelToken: CancellationToken): Promise<LocalKernelSpecConnectionMetadata[]> {
        const promise = this.listKernelsWithCache('LocalKnownPathKernelSpecFinder', false, async () => {
            // First find the on disk kernel specs and interpreters
            const kernelSpecs = await this.findKernelSpecs(cancelToken);

            const newKernelSpecs = kernelSpecs.map((k) =>
                LocalKernelSpecConnectionMetadata.create({
                    kernelSpec: k,
                    interpreter: undefined,
                    id: getKernelId(k)
                })
            );
            if (cancelToken.isCancellationRequested) {
                return [];
            }
            const oldSortedKernels = Array.from(this._cachedKernels.values()).sort((a, b) => a.id.localeCompare(b.id));
            const newSortedKernels = newKernelSpecs.sort((a, b) => a.id.localeCompare(b.id));
            const newKernelIds = new Set(newKernelSpecs.map((k) => k.id));
            const deletedKernels = oldSortedKernels.filter((k) => !newKernelIds.has(k.id));

            // Add/update the kernels.
            newKernelSpecs.forEach((k) => this._cachedKernels.set(k.id, k));

            // Trigger a change event if we have different kernels.
            if (
                oldSortedKernels.length !== newSortedKernels.length ||
                deletedKernels.length ||
                JSON.stringify(oldSortedKernels) !== JSON.stringify(newSortedKernels)
            ) {
                this._onDidChangeKernels.fire();
                this.writeToMementoCache(
                    Array.from(this._cachedKernels.values()),
                    LocalKernelSpecsCacheKey
                ).ignoreErrors();
            }
            this._onDidChangeKernels.fire();
            if (deletedKernels.length) {
                traceVerbose(
                    `Local kernel spec connection deleted ${deletedKernels.map((item) => `${item.kind}:'${item.id}'`)}`
                );
            }
            return newKernelSpecs;
        });
        this.promiseMonitor.push(promise);
        return promise;
    }
    private async findKernelSpecs(cancelToken: CancellationToken): Promise<IJupyterKernelSpec[]> {
        let results: IJupyterKernelSpec[] = [];

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
        await Promise.all(
            searchResults.flat().map(async (kernelSpecFile) => {
                try {
                    if (cancelToken.isCancellationRequested) {
                        return;
                    }
                    // Add these into our path cache to speed up later finds
                    const kernelSpec = await this.kernelSpecFinder.loadKernelSpec(kernelSpecFile, cancelToken);
                    if (kernelSpec) {
                        sendKernelSpecTelemetry(kernelSpec, 'local');
                        results.push(kernelSpec);
                    }
                } catch (ex) {
                    traceError(`Failed to load kernelSpec for ${kernelSpecFile}`, ex);
                }
            })
        );

        // Filter out duplicates. This can happen when
        // 1) Conda installs kernel
        // 2) Same kernel is registered in the global location
        // We should have extra metadata on the global location pointing to the original
        const originalSpecFiles = new Set<string>();
        results.forEach((r) => {
            if (r.metadata?.originalSpecFile) {
                originalSpecFiles.add(r.metadata.originalSpecFile);
            }
        });
        results = results.filter((r) => !r.specFile || !originalSpecFiles.has(r.specFile));

        // There was also an old bug where the same item would be registered more than once. Eliminate these dupes
        // too.
        const unique: IJupyterKernelSpec[] = [];
        const byDisplayName = new Map<string, IJupyterKernelSpec>();
        results.forEach((r) => {
            const existing = byDisplayName.get(r.display_name);
            if (existing && existing.executable !== r.executable) {
                // This item is a dupe but has a different path to start the exe
                unique.push(r);
            } else if (!existing) {
                unique.push(r);
                byDisplayName.set(r.display_name, r);
            }
        });
        return unique;
    }
}
