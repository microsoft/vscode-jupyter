// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { inject, injectable } from 'inversify';
import { CancellationToken } from 'vscode';
import { IWorkspaceService } from '../../common/application/types';
import { IFileSystem } from '../../common/platform/types';
import { Resource } from '../../common/types';
import { getKernelId } from '../jupyter/kernels/helpers';
import { KernelSpecConnectionMetadata, PythonKernelConnectionMetadata } from '../jupyter/kernels/types';
import { IJupyterKernelSpec } from '../types';
import { LocalKernelFinderBase } from './localFinderBase';
import { JupyterPaths } from './jupyterPaths';

@injectable()
export class LocalNonPythonKernelFinder extends LocalKernelFinderBase {
    constructor(
        @inject(IFileSystem) fs: IFileSystem,
        @inject(IWorkspaceService) workspaceService: IWorkspaceService,
        @inject(JupyterPaths) private readonly jupyterPaths: JupyterPaths
    ) {
        super(fs, workspaceService);
    }
    protected async listKernelsImplementation(
        _resource: Resource,
        cancelToken?: CancellationToken
    ): Promise<(KernelSpecConnectionMetadata | PythonKernelConnectionMetadata)[]> {
        // First find the on disk kernel specs and interpreters
        const kernelSpecs = await this.findKernelSpecs(cancelToken);

        // Then go through all of the kernels and generate their metadata
        const distinctKernelMetadata = new Map<string, KernelSpecConnectionMetadata | PythonKernelConnectionMetadata>();
        await Promise.all(
            kernelSpecs
                .map(
                    (k) =>
                        <KernelSpecConnectionMetadata>{
                            kind: 'startUsingKernelSpec',
                            kernelSpec: k,
                            interpreter: undefined,
                            id: getKernelId(k)
                        }
                )
                .map((kernelSpec: KernelSpecConnectionMetadata) => {
                    // Check if we have already seen this.
                    if (!distinctKernelMetadata.has(kernelSpec.id)) {
                        distinctKernelMetadata.set(kernelSpec.id, kernelSpec);
                    }
                })
        );

        // Sort them so that the active interpreter comes first (if we have one for it).
        // This allows searches to prioritize this kernel first. If you sort for
        // a UI do it after this function is called.
        return Array.from(distinctKernelMetadata.values()).sort((a, b) => {
            if (a.kernelSpec?.display_name === b.kernelSpec?.display_name) {
                return 0;
            } else {
                return 1;
            }
        });
    }

    private async findKernelSpecs(cancelToken?: CancellationToken): Promise<IJupyterKernelSpec[]> {
        let results: IJupyterKernelSpec[] = [];

        // Find all the possible places to look for this resource
        const paths = await this.jupyterPaths.getKernelSpecRootPaths(cancelToken);
        const searchResults = await this.kernelGlobSearch(paths, cancelToken);

        await Promise.all(
            searchResults.map(async (resultPath) => {
                // Add these into our path cache to speed up later finds
                const kernelspec = await this.getKernelSpec(
                    resultPath.kernelSpecFile,
                    resultPath.interpreter,
                    cancelToken
                );

                if (kernelspec) {
                    results.push(kernelspec);
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
            if (existing && existing.path !== r.path) {
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
