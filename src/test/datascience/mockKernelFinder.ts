// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import type { nbformat } from '@jupyterlab/coreutils';
import { CancellationToken } from 'vscode';
import { Resource } from '../../client/common/types';
import { IKernelFinder } from '../../client/datascience/kernel-launcher/types';
import { IJupyterKernelSpec } from '../../client/datascience/types';
import { PythonEnvironment } from '../../client/pythonEnvironments/info';

export class MockKernelFinder implements IKernelFinder {
    private dummySpecs = new Map<string, IJupyterKernelSpec>();

    constructor(private readonly realFinder: IKernelFinder) {}

    public async findKernelSpec(
        resource: Resource,
        option?: nbformat.INotebookMetadata | PythonEnvironment,
        _cancelToken?: CancellationToken
    ): Promise<IJupyterKernelSpec | undefined> {
        const spec = option?.path
            ? this.dummySpecs.get(option.path as string)
            : this.dummySpecs.get(((option?.path as string) || '').toString());
        if (spec) {
            return spec;
        }
        return this.realFinder.findKernelSpec(resource, option);
    }

    public async listKernelSpecs(): Promise<IJupyterKernelSpec[]> {
        throw new Error('Not yet implemented');
    }

    public addKernelSpec(pythonPathOrResource: string, spec: IJupyterKernelSpec) {
        this.dummySpecs.set(pythonPathOrResource, spec);
    }
}
