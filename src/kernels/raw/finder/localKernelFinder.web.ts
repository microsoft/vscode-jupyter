/* eslint-disable @typescript-eslint/no-explicit-any */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import type * as nbformat from '@jupyterlab/nbformat';
import { injectable } from 'inversify';
import { CancellationToken } from 'vscode';
import { LocalKernelConnectionMetadata } from '../../../kernels/types';
import { traceDecoratorVerbose, ignoreLogging, traceDecoratorError } from '../../../platform/logging';
import { Resource } from '../../../platform/common/types';
import { captureTelemetry } from '../../../telemetry';
import { Telemetry } from '../../../webviews/webview-side/common/constants';
import { ILocalKernelFinder } from '../types';
import { TraceOptions } from '../../../platform/logging/types';

// The plan is to remove this later and refactor the NotebookControllerManager to not know the difference between local and remote
// Instead there will be a IKernelFinder for web and an IKernelFinder for node. It will coalesce the local/remote bits.
// But for now, it was simpler to just make this kernel finder that returns nothing.
@injectable()
export class LocalKernelFinder implements ILocalKernelFinder {
    @traceDecoratorVerbose('Find kernel spec', TraceOptions.BeforeCall | TraceOptions.Arguments)
    @captureTelemetry(Telemetry.KernelFinderPerf)
    public async findKernel(
        _resource: Resource,
        _notebookMetadata?: nbformat.INotebookMetadata,
        @ignoreLogging() _cancelToken?: CancellationToken
    ): Promise<LocalKernelConnectionMetadata | undefined> {
        return undefined;
    }

    /**
     * Search all our local file system locations for installed kernel specs and return them
     */
    @traceDecoratorError('List kernels failed')
    public async listKernels(
        _resource: Resource,
        @ignoreLogging() _cancelToken?: CancellationToken,
        _useCache: 'useCache' | 'ignoreCache' = 'ignoreCache'
    ): Promise<LocalKernelConnectionMetadata[]> {
        return [];
    }

    public findPreferredLocalKernelConnectionFromCache(
        _notebookMetadata?: nbformat.INotebookMetadata
    ): LocalKernelConnectionMetadata | undefined {
        return undefined;
    }
}
