// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import type { Kernel } from '@jupyterlab/services';
import * as path from 'path';
import { CancellationToken } from 'vscode';
import { createPromiseFromCancellation } from '../../../common/cancellation';
import { traceInfo } from '../../../common/logger';
import { IFileSystem } from '../../../common/platform/types';

import { IPythonExecutionFactory } from '../../../common/process/types';
import { PythonEnvironment } from '../../../pythonEnvironments/info';
import { getRealPath } from '../../common';
import { IJupyterKernelSpec } from '../../types';

export class JupyterKernelSpec implements IJupyterKernelSpec {
    public name: string;
    public language: string;
    public path: string;
    public readonly env: NodeJS.ProcessEnv | undefined;
    public display_name: string;
    public argv: string[];
    public interrupt_mode?: 'message' | 'signal';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public metadata?: Record<string, any> & { interpreter?: Partial<PythonEnvironment> };
    constructor(
        specModel: Kernel.ISpecModel,
        public readonly specFile?: string,
        public readonly interpreterPath?: string
    ) {
        this.name = specModel.name;
        this.argv = specModel.argv;
        this.language = specModel.language;
        this.path = specModel.argv && specModel.argv.length > 0 ? specModel.argv[0] : '';
        this.display_name = specModel.display_name;
        this.metadata = specModel.metadata;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.env = specModel.env as any; // JSONObject, but should match
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.interrupt_mode = specModel.interrupt_mode as any;
    }
}

/**
 * Given the stdout contents from the command `python -m jupyter kernelspec list --json` this will parser that and build a list of kernelspecs.
 *
 * @export
 * @param {string} stdout
 * @param {IFileSystem} fs
 * @param {CancellationToken} [token]
 * @returns
 */
export async function parseKernelSpecs(
    stdout: string,
    fs: IFileSystem,
    execFactory: IPythonExecutionFactory,
    token?: CancellationToken
) {
    traceInfo('Parsing kernelspecs from jupyter');
    // This should give us back a key value pair we can parse
    const jsOut = JSON.parse(stdout.trim()) as {
        kernelspecs: Record<string, { resource_dir: string; spec: Omit<Kernel.ISpecModel, 'name'> }>;
    };
    const kernelSpecs = jsOut.kernelspecs;

    const specs = await Promise.race([
        Promise.all(
            Object.keys(kernelSpecs).map(async (kernelName) => {
                const spec = kernelSpecs[kernelName].spec as Kernel.ISpecModel;
                // Add the missing name property.
                const model = {
                    ...spec,
                    name: kernelName
                };
                const specFile = await getRealPath(
                    fs,
                    execFactory,
                    spec.argv[0],
                    path.join(kernelSpecs[kernelName].resource_dir, 'kernel.json')
                );
                if (specFile) {
                    return new JupyterKernelSpec(model as Kernel.ISpecModel, specFile);
                }
            })
        ),
        createPromiseFromCancellation({ cancelAction: 'resolve', defaultValue: [], token })
    ]);
    return specs.filter((item) => !!item).map((item) => item as JupyterKernelSpec);
}
