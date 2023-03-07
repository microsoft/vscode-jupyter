// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { traceWarning } from '../../../platform/logging';
import { LiveRemoteKernelConnectionMetadata } from '../../types';
import { extractJupyterServerHandleAndId } from '../jupyterUtils';
import {
    IJupyterRemoteCachedKernelValidator,
    IJupyterServerUriStorage,
    IJupyterUriProviderRegistration,
    ILiveRemoteKernelConnectionUsageTracker
} from '../types';

/**
 * Used to verify remote jupyter connections from 3rd party URIs are still valid.
 */
@injectable()
export class JupyterRemoteCachedKernelValidator implements IJupyterRemoteCachedKernelValidator {
    constructor(
        @inject(ILiveRemoteKernelConnectionUsageTracker)
        private readonly liveKernelConnectionTracker: ILiveRemoteKernelConnectionUsageTracker,

        @inject(IJupyterServerUriStorage) private readonly uriStorage: IJupyterServerUriStorage,
        @inject(IJupyterUriProviderRegistration) private readonly providerRegistration: IJupyterUriProviderRegistration
    ) {}
    public async isValid(kernel: LiveRemoteKernelConnectionMetadata): Promise<boolean> {
        // Only list live kernels that was used by the user,
        if (!this.liveKernelConnectionTracker.wasKernelUsed(kernel)) {
            return false;
        }
        const providersPromise = this.providerRegistration.getProviders();
        const currentList = await this.uriStorage.getSavedUriList();
        const item = currentList.find((item) => item.serverId === kernel.serverId);
        if (!item) {
            // Server has been removed and we have some old cached data.
            return false;
        }
        // Check if this has a provider associated with it.
        const info = extractJupyterServerHandleAndId(item.uri);
        if (!info) {
            // Could be a regular remote Jupyter Uri entered by the user.
            // As its in the list, its still valid.
            return true;
        }
        const providers = await providersPromise;
        const provider = providers.find((item) => item.id === info.id);
        if (!provider) {
            traceWarning(`Extension may have been uninstalled for provider ${info.id}, handle ${info.handle}`);
            return false;
        }
        if (provider.getHandles) {
            const handles = await provider.getHandles();
            if (handles.includes(info.handle)) {
                return true;
            } else {
                traceWarning(
                    `Hiding remote kernel ${kernel.id} as the remote Jupyter Server ${item.uri} is no longer available`
                );
                // 3rd party extensions own these kernels, if these are no longer
                // available, then just don't display them.
                return false;
            }
        }

        // List this old cached kernel even if such a server matching this kernel no longer exists.
        // This way things don't just disappear from the kernel picker &
        // user will get notified when they attempt to re-use this kernel.
        return true;
    }
}
