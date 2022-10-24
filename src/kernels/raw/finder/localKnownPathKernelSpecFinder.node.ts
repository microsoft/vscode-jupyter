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
import { IWorkspaceService } from '../../../platform/common/application/types';
import { traceInfo, traceError } from '../../../platform/logging';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import { IMemento, GLOBAL_MEMENTO, IDisposableRegistry } from '../../../platform/common/types';
import { capturePerfTelemetry, Telemetry } from '../../../telemetry';
import { sendKernelSpecTelemetry } from './helper';
import { noop } from '../../../platform/common/utils/misc';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';

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
    private _cachedKernels: LocalKernelSpecConnectionMetadata[] = [];
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
        @inject(JupyterPaths) private readonly jupyterPaths: JupyterPaths,
        @inject(IPythonExtensionChecker) extensionChecker: IPythonExtensionChecker,
        @inject(IMemento) @named(GLOBAL_MEMENTO) memento: Memento,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry
    ) {
        super(fs, workspaceService, extensionChecker, memento, disposables);
        if (this.oldKernelSpecsFolder) {
            traceInfo(
                `Old kernelSpecs (created by Jupyter Extension) stored in directory ${this.oldKernelSpecsFolder}`
            );
        }
    }
    activate(): void {
        const cancellation = new CancellationTokenSource();
        this.listKernelSpecs(cancellation.token)
            .then(noop, noop)
            .finally(() => cancellation.dispose());
    }
    public get kernels(): LocalKernelSpecConnectionMetadata[] {
        return this._cachedKernels;
    }
    public dispose(): void | undefined {
        this._onDidChangeKernels.dispose();
    }
    /**
     * @param {boolean} includePythonKernels Include/exclude Python kernels in the result.
     */
    @capturePerfTelemetry(Telemetry.KernelListingPerf, { kind: 'localKernelSpec' })
    private async listKernelSpecs(cancelToken: CancellationToken): Promise<LocalKernelSpecConnectionMetadata[]> {
        return this.listKernelsWithCache('LocalKnownPathKernelSpecFinder', false, async () => {
            // First find the on disk kernel specs and interpreters
            const kernelSpecs = await this.findKernelSpecs(cancelToken);

            const mappedKernelSpecs = kernelSpecs.map(
                (k) =>
                    <LocalKernelSpecConnectionMetadata>{
                        kind: 'startUsingLocalKernelSpec',
                        kernelSpec: k,
                        interpreter: undefined,
                        id: getKernelId(k)
                    }
            );
            if (cancelToken.isCancellationRequested) {
                return [];
            }
            const oldKernels = this._cachedKernels;
            this._cachedKernels = mappedKernelSpecs;

            // Trigger a change event if we have different kernels.
            oldKernels.sort();
            mappedKernelSpecs.sort();
            if (
                oldKernels.length !== mappedKernelSpecs.length ||
                JSON.stringify(oldKernels) !== JSON.stringify(mappedKernelSpecs)
            ) {
                this._onDidChangeKernels.fire();
            }
            this._onDidChangeKernels.fire();
            return mappedKernelSpecs;
        });
    }
    private async findKernelSpecs(cancelToken: CancellationToken): Promise<IJupyterKernelSpec[]> {
        let results: IJupyterKernelSpec[] = [];

        // Find all the possible places to look for this resource
        const [paths, globalKernelPath] = await Promise.all([
            this.jupyterPaths.getKernelSpecRootPaths(cancelToken),
            this.jupyterPaths.getKernelSpecRootPath()
        ]);
        if (cancelToken.isCancellationRequested) {
            return [];
        }
        const searchResults = await this.findKernelSpecsInPaths(paths, cancelToken);
        if (cancelToken.isCancellationRequested) {
            return [];
        }
        await Promise.all(
            searchResults.map(async (resultPath) => {
                try {
                    if (cancelToken.isCancellationRequested) {
                        return;
                    }
                    // Add these into our path cache to speed up later finds
                    const kernelSpec = await this.getKernelSpec(
                        resultPath.kernelSpecFile,
                        cancelToken,
                        resultPath.interpreter,
                        globalKernelPath
                    );
                    if (kernelSpec) {
                        sendKernelSpecTelemetry(kernelSpec, 'local');
                        results.push(kernelSpec);
                    }
                } catch (ex) {
                    traceError(`Failed to load kernelSpec for ${resultPath.kernelSpecFile}`, ex);
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
