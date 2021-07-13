// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import type { nbformat } from '@jupyterlab/coreutils';
import { inject, injectable } from 'inversify';
import { CancellationToken } from 'vscode';
import { IPythonExtensionChecker } from '../../api/types';
import { PYTHON_LANGUAGE } from '../../common/constants';
import { traceDecorators, traceError, traceInfo } from '../../common/logger';
import { IExtensions, Resource } from '../../common/types';
import { IInterpreterService } from '../../interpreter/contracts';
import { captureTelemetry, sendTelemetryEvent } from '../../telemetry';
import { Telemetry } from '../constants';
import {
    findPreferredKernel,
    getDisplayNameOrNameOfKernelConnection,
    getLanguageInNotebookMetadata
} from '../jupyter/kernels/helpers';
import {
    KernelSpecConnectionMetadata,
    LocalKernelConnectionMetadata,
    PythonKernelConnectionMetadata
} from '../jupyter/kernels/types';
import { ILocalKernelFinder } from './types';
import { getResourceType } from '../common';
import { isPythonNotebook } from '../notebook/helpers/helpers';
import { getTelemetrySafeLanguage } from '../../telemetry/helpers';
import { sendKernelListTelemetry } from '../telemetry/kernelTelemetry';
import { LocalPythonAndRelatedNonPythonKernelSpecFinder } from './localPythonAndRelatedNonPythonKernelSpecFinder';
import { LocalKnownPathKernelSpecFinder } from './localKnownPathKernelSpecFinder';
import { JupyterPaths } from './jupyterPaths';

// This class searches for a kernel that matches the given kernel name.
// First it searches on a global persistent state, then on the installed python interpreters,
// and finally on the default locations that jupyter installs kernels on.
@injectable()
export class LocalKernelFinder implements ILocalKernelFinder {
    constructor(
        @inject(IInterpreterService) private interpreterService: IInterpreterService,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IExtensions) private readonly extensions: IExtensions,
        @inject(LocalKnownPathKernelSpecFinder) private readonly nonPythonkernelFinder: LocalKnownPathKernelSpecFinder,
        @inject(LocalPythonAndRelatedNonPythonKernelSpecFinder)
        private readonly pythonKernelFinder: LocalPythonAndRelatedNonPythonKernelSpecFinder,
        @inject(JupyterPaths) private readonly jupyterPaths: JupyterPaths
    ) {}
    @traceDecorators.verbose('Find kernel spec')
    @captureTelemetry(Telemetry.KernelFinderPerf)
    public async findKernel(
        resource: Resource,
        notebookMetadata?: nbformat.INotebookMetadata,
        cancelToken?: CancellationToken
    ): Promise<LocalKernelConnectionMetadata | undefined> {
        const resourceType = getResourceType(resource);
        const telemetrySafeLanguage =
            resourceType === 'interactive'
                ? PYTHON_LANGUAGE
                : getTelemetrySafeLanguage(getLanguageInNotebookMetadata(notebookMetadata) || '');
        try {
            // Get list of all of the specs
            const kernels = await this.listKernels(resource, cancelToken);
            const isPythonNbOrInteractiveWindow = isPythonNotebook(notebookMetadata) || resourceType === 'interactive';
            // Always include the interpreter in the search if we can
            const preferredInterpreter =
                isPythonNbOrInteractiveWindow && this.extensionChecker.isPythonExtensionInstalled
                    ? await this.interpreterService.getActiveInterpreter(resource)
                    : undefined;

            // Find the preferred kernel index from the list.
            const preferred = findPreferredKernel(
                kernels,
                resource,
                [],
                notebookMetadata,
                preferredInterpreter,
                undefined
            );
            sendTelemetryEvent(Telemetry.PreferredKernel, undefined, {
                result: preferred ? 'found' : 'notfound',
                resourceType,
                language: telemetrySafeLanguage,
                hasActiveInterpreter: !!preferredInterpreter
            });
            if (preferred) {
                traceInfo(`findKernel found ${getDisplayNameOrNameOfKernelConnection(preferred)}`);
                return preferred as LocalKernelConnectionMetadata;
            }
        } catch (ex) {
            sendTelemetryEvent(
                Telemetry.PreferredKernel,
                undefined,
                {
                    result: 'failed',
                    resourceType,
                    language: telemetrySafeLanguage
                },
                ex,
                true
            );
            traceError(`findKernel crashed`, ex);
            return undefined;
        }
    }

    public async listNonPythonKernels(cancelToken?: CancellationToken): Promise<LocalKernelConnectionMetadata[]> {
        return this.filterKernels(await this.nonPythonkernelFinder.listKernelSpecs(false, cancelToken));
    }

    /**
     * Search all our local file system locations for installed kernel specs and return them
     */
    @captureTelemetry(Telemetry.KernelListingPerf)
    @traceDecorators.error('List kernels failed')
    public async listKernels(
        resource: Resource,
        cancelToken?: CancellationToken
    ): Promise<LocalKernelConnectionMetadata[]> {
        let [nonPythonKernelSpecs, pythonRelatedKernelSpecs] = await Promise.all([
            this.nonPythonkernelFinder.listKernelSpecs(false, cancelToken),
            this.pythonKernelFinder.listKernelSpecs(resource, cancelToken)
        ]);

        const kernels = this.filterKernels(nonPythonKernelSpecs.concat(pythonRelatedKernelSpecs));
        sendKernelListTelemetry(resource, kernels);
        return kernels;
    }

    // This should return a WRITABLE place that jupyter will look for a kernel as documented
    // here: https://jupyter-client.readthedocs.io/en/stable/kernels.html#kernel-specs
    public async getKernelSpecRootPath(): Promise<string | undefined> {
        return this.jupyterPaths.getKernelSpecRootPath();
    }
    private filterKernels(kernels: (KernelSpecConnectionMetadata | PythonKernelConnectionMetadata)[]) {
        return kernels.filter(({ kernelSpec }) => {
            // Disable xeus python for now.
            if (kernelSpec.argv[0].toLowerCase().endsWith('xpython')) {
                traceInfo(`Hiding xeus kernelspec`);
                return false;
            }
            const extensionId = kernelSpec.metadata?.vscode?.extension_id;
            if (extensionId && this.extensions.getExtension(extensionId)) {
                traceInfo(`Hiding kernelspec ${kernelSpec.display_name}, better support by ${extensionId}`);
                return false;
            }
            return true;
        });
    }
}
