// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { CancellationToken } from 'vscode';
import { IPathUtils, Resource } from '../../../../common/types';
import * as localize from '../../../../common/utils/localize';
import { IJupyterKernelSpec, IJupyterSessionManager } from '../../../types';
import {
    IKernelSelectionListProvider,
    IKernelSpecQuickPickItem,
    LiveKernelConnectionMetadata,
    LiveKernelModel
} from '../types';

// Small classes, hence all put into one file.
/* eslint-disable max-classes-per-file */

/**
 * Given an active kernel, this will return a quick pick item with appropriate display names and the like.
 *
 * @param {(LiveKernelModel)} kernel
 * @param {IPathUtils} pathUtils
 * @returns {IKernelSpecQuickPickItem}
 */
export function getQuickPickItemForActiveKernel(
    kernel: LiveKernelModel,
    pathUtils: IPathUtils
): IKernelSpecQuickPickItem<LiveKernelConnectionMetadata> {
    const pickPath = kernel.metadata?.interpreter?.path || kernel.path;
    return {
        label: kernel.display_name || kernel.name || '',
        // If we have a session, use that path
        detail: kernel.session.path || !pickPath ? kernel.session.path : pathUtils.getDisplayName(pickPath),
        description: localize.DataScience.jupyterSelectURIRunningDetailFormat().format(
            kernel.lastActivityTime.toLocaleString(),
            kernel.numberOfConnections.toString()
        ),
        selection: { kernelModel: kernel, interpreter: undefined, kind: 'connectToLiveKernel' }
    };
}

/**
 * Provider for active kernel specs in a jupyter session.
 *
 * @export
 * @class ActiveJupyterSessionKernelSelectionListProvider
 * @implements {IKernelSelectionListProvider}
 */
export class ActiveJupyterSessionKernelSelectionListProvider
    implements IKernelSelectionListProvider<LiveKernelConnectionMetadata> {
    constructor(private readonly sessionManager: IJupyterSessionManager, private readonly pathUtils: IPathUtils) {}
    public async getKernelSelections(
        _resource: Resource,
        _cancelToken?: CancellationToken | undefined
    ): Promise<IKernelSpecQuickPickItem<LiveKernelConnectionMetadata>[]> {
        const [activeKernels, activeSessions, kernelSpecs] = await Promise.all([
            this.sessionManager.getRunningKernels(),
            this.sessionManager.getRunningSessions(),
            this.sessionManager.getKernelSpecs()
        ]);
        const items = activeSessions.map((item) => {
            const matchingSpec: Partial<IJupyterKernelSpec> =
                kernelSpecs.find((spec) => spec.name === item.kernel.name) || {};
            const activeKernel = activeKernels.find((active) => active.id === item.kernel.id) || {};
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            return {
                ...item.kernel,
                ...matchingSpec,
                ...activeKernel,
                session: item
            } as LiveKernelModel;
        });
        return items
            .filter((item) => item.display_name || item.name)
            .filter((item) => 'lastActivityTime' in item && 'numberOfConnections' in item)
            .map((item) => getQuickPickItemForActiveKernel(item, this.pathUtils));
    }
}
