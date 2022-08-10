// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable, named } from 'inversify';
import { CancellationToken, Memento } from 'vscode';
import { getKernelId } from '../../../kernels/helpers';
import {
    IJupyterKernelSpec,
    LocalKernelSpecConnectionMetadata,
    PythonKernelConnectionMetadata
} from '../../../kernels/types';
import { LocalKernelSpecFinderBase } from './localKernelSpecFinderBase.node';
import { JupyterPaths } from './jupyterPaths.node';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { IWorkspaceService } from '../../../platform/common/application/types';
import { PYTHON_LANGUAGE } from '../../../platform/common/constants';
import { traceInfo, traceError } from '../../../platform/logging';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import { IMemento, GLOBAL_MEMENTO } from '../../../platform/common/types';
import { captureTelemetry, Telemetry } from '../../../telemetry';
import { sendKernelSpecTelemetry } from './helper';

/**
 * This class searches for kernels on the file system in well known paths documented by Jupyter.
 * This will return Python, Julia, R etc kernels.
 * Returns all kernels regardless of whether Python extension is installed or not.
 */
@injectable()
export class LocalKnownPathKernelSpecFinder extends LocalKernelSpecFinderBase {
    constructor(
        @inject(IFileSystemNode) fs: IFileSystemNode,
        @inject(IWorkspaceService) workspaceService: IWorkspaceService,
        @inject(JupyterPaths) private readonly jupyterPaths: JupyterPaths,
        @inject(IPythonExtensionChecker) extensionChecker: IPythonExtensionChecker,
        @inject(IMemento) @named(GLOBAL_MEMENTO) memento: Memento
    ) {
        super(fs, workspaceService, extensionChecker, memento);
        if (this.oldKernelSpecsFolder) {
            traceInfo(
                `Old kernelSpecs (created by Jupyter Extension) stored in directory ${this.oldKernelSpecsFolder}`
            );
        }
    }
    /**
     * @param {boolean} includePythonKernels Include/exclude Python kernels in the result.
     */
    @captureTelemetry(Telemetry.KernelListingPerf, { kind: 'localKernelSpec' })
    public async listKernelSpecs(
        includePythonKernels: boolean,
        cancelToken?: CancellationToken
    ): Promise<(LocalKernelSpecConnectionMetadata | PythonKernelConnectionMetadata)[]> {
        return this.listKernelsWithCache(
            includePythonKernels ? 'IncludePythonV2' : 'ExcludePythonV2',
            false,
            async () => {
                // First find the on disk kernel specs and interpreters
                const kernelSpecs = await this.findKernelSpecs(cancelToken);

                return kernelSpecs
                    .filter((item) => {
                        if (includePythonKernels) {
                            return true;
                        }
                        return item.language !== PYTHON_LANGUAGE;
                    })
                    .map(
                        (k) =>
                            <LocalKernelSpecConnectionMetadata>{
                                kind: 'startUsingLocalKernelSpec',
                                kernelSpec: k,
                                interpreter: undefined,
                                id: getKernelId(k)
                            }
                    );
            }
        );
    }
    private async findKernelSpecs(cancelToken?: CancellationToken): Promise<IJupyterKernelSpec[]> {
        let results: IJupyterKernelSpec[] = [];

        // Find all the possible places to look for this resource
        const [paths, globalKernelPath] = await Promise.all([
            this.jupyterPaths.getKernelSpecRootPaths(cancelToken),
            this.jupyterPaths.getKernelSpecRootPath()
        ]);
        const searchResults = await this.findKernelSpecsInPaths(paths, cancelToken);
        await Promise.all(
            searchResults.map(async (resultPath) => {
                try {
                    // Add these into our path cache to speed up later finds
                    const kernelSpec = await this.getKernelSpec(
                        resultPath.kernelSpecFile,
                        resultPath.interpreter,
                        globalKernelPath,
                        cancelToken
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
                originalSpecFiles.add(r.metadata?.originalSpecFile);
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
