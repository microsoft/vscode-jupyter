// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import type { nbformat } from '@jupyterlab/coreutils';
import { CancellationToken } from 'vscode';
import { Resource } from '../../client/common/types';
import { LocalKernelConnectionMetadata } from '../../client/datascience/jupyter/kernels/types';
import { ILocalKernelFinder } from '../../client/datascience/kernel-launcher/types';
import { PythonEnvironment } from '../../client/pythonEnvironments/info';

export class MockKernelFinder implements ILocalKernelFinder {
    private dummySpecs = new Map<string, LocalKernelConnectionMetadata>();

    constructor(private readonly realFinder: ILocalKernelFinder) {}

    public async findKernel(
        resource: Resource,
        option?: nbformat.INotebookMetadata | PythonEnvironment,
        _cancelToken?: CancellationToken
    ): Promise<LocalKernelConnectionMetadata | undefined> {
        const spec = option?.path
            ? this.dummySpecs.get(option.path as string)
            : this.dummySpecs.get(((option?.path as string) || '').toString());
        if (spec) {
            return spec;
        }
        return this.realFinder.findKernel(resource, option);
    }

    public async listKernels(_resource: Resource): Promise<LocalKernelConnectionMetadata[]> {
        throw new Error('Not yet implemented');
    }

    public addKernelSpec(pythonPathOrResource: string, spec: LocalKernelConnectionMetadata) {
        this.dummySpecs.set(pythonPathOrResource, spec);
    }
    public clearCache(_resource: Resource): void {
        // Do nothing.
    }
}
