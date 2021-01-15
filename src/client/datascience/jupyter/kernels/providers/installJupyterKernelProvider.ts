// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { cloneDeep } from 'lodash';
import * as path from 'path';
import { CancellationToken } from 'vscode';
import { IPythonExtensionChecker } from '../../../../api/types';
import { PYTHON_LANGUAGE } from '../../../../common/constants';
import { IPathUtils, Resource, ReadWrite } from '../../../../common/types';
import { IInterpreterService } from '../../../../interpreter/contracts';
import { sendTelemetryEvent } from '../../../../telemetry';
import { Telemetry } from '../../../constants';
import { IJupyterKernelSpec, IJupyterSessionManager } from '../../../types';
import { isPythonKernelConnection } from './../helpers';
import { KernelService } from './../kernelService';
import { IKernelSelectionListProvider, IKernelSpecQuickPickItem, KernelSpecConnectionMetadata } from './../types';

// Small classes, hence all put into one file.
/* eslint-disable max-classes-per-file */

/**
 * Given a kernel spec, this will return a quick pick item with appropriate display names and the like.
 *
 * @param {IJupyterKernelSpec} kernelSpec
 * @param {IPathUtils} pathUtils
 * @returns {IKernelSpecQuickPickItem}
 */
export function getQuickPickItemForKernelSpec(
    kernelSpec: IJupyterKernelSpec,
    pathUtils: IPathUtils
): IKernelSpecQuickPickItem<KernelSpecConnectionMetadata> {
    // If we have a matching interpreter, then display that path in the dropdown else path of the kernelspec.
    const pathToKernel = kernelSpec.metadata?.interpreter?.path || kernelSpec.path;

    // Its possible we could have kernels with the same name.
    // Include the path of the interpreter that owns this kernel or path of kernelspec.json file in description.
    // If we only have name of executable like `dotnet` or `python`, then include path to kernel json.
    // Similarly if this is a python kernel and pathTokernel is just `python`, look for corresponding interpreter that owns this and include its path.

    // E.g.
    // If its a python kernel with python path in kernel spec we display:
    //  detail: ~/user friendly path to python interpreter
    // If its a non-python kernel and we have the fully qualified path to executable:
    //  detail: ~/user friendly path to executable
    // If its a non-python kernel and we only have name of executable like `java/dotnet` & we we have the fully qualified path to interpreter that owns this kernel:
    //  detail: ~/user friendly path to kenelspec.json file

    let detail = pathUtils.getDisplayName(pathToKernel);
    if (pathToKernel === path.basename(pathToKernel)) {
        const pathToInterpreterOrKernelSpec =
            kernelSpec.language?.toLowerCase() === PYTHON_LANGUAGE.toLocaleLowerCase()
                ? kernelSpec.interpreterPath
                : kernelSpec.specFile || '';
        if (pathToInterpreterOrKernelSpec) {
            detail = pathUtils.getDisplayName(pathToInterpreterOrKernelSpec);
        }
    }
    return {
        label: kernelSpec.display_name,
        detail,
        selection: {
            kernelModel: undefined,
            kernelSpec: kernelSpec,
            interpreter: undefined,
            kind: 'startUsingKernelSpec'
        }
    };
}

/**
 * Provider for installed kernel specs (`python -m jupyter kernelspec list`).
 *
 * @export
 * @class InstalledJupyterKernelSelectionListProvider
 * @implements {IKernelSelectionListProvider}
 */
export class InstalledJupyterKernelSelectionListProvider
    implements IKernelSelectionListProvider<KernelSpecConnectionMetadata> {
    constructor(
        private readonly kernelService: KernelService,
        private readonly pathUtils: IPathUtils,
        private readonly extensionChecker: IPythonExtensionChecker,
        private readonly interpreterService: IInterpreterService,
        private readonly sessionManager?: IJupyterSessionManager
    ) {}
    public async getKernelSelections(
        resource: Resource,
        cancelToken?: CancellationToken | undefined
    ): Promise<IKernelSpecQuickPickItem<KernelSpecConnectionMetadata>[]> {
        const items = await this.kernelService.getKernelSpecs(this.sessionManager, cancelToken);
        // Always clone, so we can make changes to this.
        const selections = items.map((item) => getQuickPickItemForKernelSpec(cloneDeep(item), this.pathUtils));

        // Default the interpreter to the local interpreter (if none is provided).
        if (this.extensionChecker.isPythonExtensionInstalled) {
            const activeInterpreter = this.interpreterService.getActiveInterpreter(resource);
            // This process is slow, hence the need to cache this result set.
            await Promise.all(
                selections.map(async (item) => {
                    const selection = item.selection as ReadWrite<KernelSpecConnectionMetadata>;
                    // Find matching interpreter for Python kernels.
                    if (!selection.interpreter && selection.kernelSpec && isPythonKernelConnection(selection)) {
                        selection.interpreter = await this.kernelService.findMatchingInterpreter(selection.kernelSpec);
                    }
                    selection.interpreter = item.selection.interpreter || (await activeInterpreter);
                    if (isPythonKernelConnection(selection)) {
                        selection.kernelSpec.interpreterPath =
                            selection.kernelSpec.interpreterPath || selection.interpreter?.path;
                    }
                })
            );
        }
        sendTelemetryEvent(Telemetry.NumberOfRemoteKernelSpecs, { count: selections.length });
        return selections;
    }
}
