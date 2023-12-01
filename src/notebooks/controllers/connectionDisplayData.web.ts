// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable, inject } from 'inversify';
import {
    getDisplayNameOrNameOfKernelConnection,
    getKernelConnectionDisplayPath,
    getRemoteKernelSessionInformation
} from '../../kernels/helpers';
import { IJupyterServerProviderRegistry } from '../../kernels/jupyter/types';
import { KernelConnectionMetadata } from '../../kernels/types';
import { IPlatformService } from '../../platform/common/platform/types';
import { IDisposableRegistry } from '../../platform/common/types';
import { IConnectionDisplayData, IConnectionDisplayDataProvider } from './types';
import {
    ConnectionDisplayData,
    getKernelConnectionCategory,
    getKernelConnectionCategorySync
} from './connectionDisplayData';
import { DataScience } from '../../platform/common/utils/localize';
import { getJupyterDisplayName } from '../../kernels/jupyter/connection/jupyterServerProviderRegistry';

@injectable()
export class ConnectionDisplayDataProvider implements IConnectionDisplayDataProvider {
    private readonly details = new Map<string, ConnectionDisplayData>();
    constructor(
        @inject(IPlatformService) private readonly platform: IPlatformService,
        @inject(IJupyterServerProviderRegistry)
        private readonly jupyterUriProviderRegistration: IJupyterServerProviderRegistry,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry
    ) {}

    public getDisplayData(connection: KernelConnectionMetadata): IConnectionDisplayData {
        if (!this.details.get(connection.id)) {
            const label = getDisplayNameOrNameOfKernelConnection(connection);
            let description = getKernelConnectionDisplayPath(connection, this.platform);
            if (connection.kind === 'connectToLiveRemoteKernel') {
                description = getRemoteKernelSessionInformation(connection);
            }
            const descriptionProvider =
                connection.kind === 'connectToLiveRemoteKernel'
                    ? () => getRemoteKernelSessionInformation(connection)
                    : undefined;
            const category = getKernelConnectionCategorySync(connection);
            const newDetails = new ConnectionDisplayData(
                label,
                description,
                '',
                category,
                undefined,
                descriptionProvider
            );
            this.disposables.push(newDetails);
            this.details.set(connection.id, newDetails);
        }
        const details: ConnectionDisplayData = this.details.get(connection.id)!;
        this.details.set(connection.id, details);

        if (connection.kind === 'connectToLiveRemoteKernel' || connection.kind === 'startUsingRemoteKernelSpec') {
            const displayName = getJupyterDisplayName(
                connection.serverProviderHandle,
                this.jupyterUriProviderRegistration,
                DataScience.kernelDefaultRemoteDisplayName
            );
            if (details.serverDisplayName !== displayName) {
                details.serverDisplayName = displayName;
                details.triggerChange();
            }
        }

        const kind = getKernelConnectionCategory(connection);
        if (details.category !== kind) {
            details.category = kind;
            details.triggerChange();
        }

        return details;
    }
}
