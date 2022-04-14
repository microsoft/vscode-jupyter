// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import type * as nbformat from '@jupyterlab/nbformat';
import { injectable, inject } from 'inversify';
import { CancellationToken } from 'vscode';
import { findPreferredKernel, getLanguageInNotebookMetadata } from '../helpers';
import { INotebookProviderConnection, KernelConnectionMetadata } from '../types';
import { PYTHON_LANGUAGE } from '../../platform/common/constants';
import { ignoreLogging, traceDecoratorVerbose, traceError } from '../../platform/logging';
import { Resource } from '../../platform/common/types';
import { sendKernelListTelemetry } from '../../telemetry/kernelTelemetry';
import { captureTelemetry, sendTelemetryEvent } from '../../telemetry';
import { getTelemetrySafeLanguage } from '../../telemetry/helpers';
import { Telemetry } from '../../webviews/webview-side/common/constants';
import { IRemoteKernelFinder } from '../raw/types';
import { PreferredRemoteKernelIdProvider } from '../raw/finder/preferredRemoteKernelIdProvider';
import { getResourceType } from '../../platform/common/utils';

// This is a temporary class to just get the NotebookControllerManager to load in a web context.
@injectable()
export class RemoteKernelFinder implements IRemoteKernelFinder {
    constructor(
        @inject(PreferredRemoteKernelIdProvider)
        private readonly preferredRemoteKernelIdProvider: PreferredRemoteKernelIdProvider
    ) {}
    @traceDecoratorVerbose('Find remote kernel spec')
    @captureTelemetry(Telemetry.KernelFinderPerf)
    @captureTelemetry(Telemetry.KernelListingPerf, { kind: 'remote' })
    public async findKernel(
        resource: Resource,
        connInfo: INotebookProviderConnection | undefined,
        notebookMetadata?: nbformat.INotebookMetadata,
        @ignoreLogging() _cancelToken?: CancellationToken
    ): Promise<KernelConnectionMetadata | undefined> {
        const resourceType = getResourceType(resource);
        const telemetrySafeLanguage =
            resourceType === 'interactive'
                ? PYTHON_LANGUAGE
                : getTelemetrySafeLanguage(getLanguageInNotebookMetadata(notebookMetadata) || '');
        try {
            // Get list of all of the specs
            const kernels = await this.listKernels(resource, connInfo);

            // Find the preferred kernel index from the list.
            const preferred = findPreferredKernel(
                kernels,
                resource,
                notebookMetadata,
                undefined,
                this.preferredRemoteKernelIdProvider
            );
            sendTelemetryEvent(Telemetry.PreferredKernel, undefined, {
                result: preferred ? 'found' : 'notfound',
                resourceType,
                language: telemetrySafeLanguage
            });
            return preferred;
        } catch (ex) {
            sendTelemetryEvent(
                Telemetry.PreferredKernel,
                undefined,
                { result: 'failed', resourceType, language: telemetrySafeLanguage },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ex as any,
                true
            );
            traceError(`findKernel crashed`, ex);
        }
    }

    // Talk to the remote server to determine sessions
    public async listKernels(
        resource: Resource,
        _connInfo: INotebookProviderConnection | undefined
    ): Promise<KernelConnectionMetadata[]> {
        sendKernelListTelemetry(resource, []);
        return [];
    }
}
