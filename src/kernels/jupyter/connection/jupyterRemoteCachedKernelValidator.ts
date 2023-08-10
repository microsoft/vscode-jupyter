// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { traceWarning } from '../../../platform/logging';
import { LiveRemoteKernelConnectionMetadata } from '../../types';
import {
    IJupyterRemoteCachedKernelValidator,
    IJupyterUriProviderRegistration,
    ILiveRemoteKernelConnectionUsageTracker
} from '../types';
import { noop } from '../../../platform/common/utils/misc';

/**
 * Used to verify remote jupyter connections from 3rd party URIs are still valid.
 */
@injectable()
export class JupyterRemoteCachedKernelValidator implements IJupyterRemoteCachedKernelValidator {
    constructor(
        @inject(ILiveRemoteKernelConnectionUsageTracker)
        private readonly liveKernelConnectionTracker: ILiveRemoteKernelConnectionUsageTracker,

        @inject(IJupyterUriProviderRegistration) private readonly providerRegistration: IJupyterUriProviderRegistration
    ) {}
    public async isValid(kernel: LiveRemoteKernelConnectionMetadata): Promise<boolean> {
        // Only list live kernels that was used by the user,
        if (!this.liveKernelConnectionTracker.wasKernelUsed(kernel)) {
            return false;
        }
        const provider = await this.providerRegistration
            .getProvider(kernel.serverProviderHandle.extensionId, kernel.serverProviderHandle.id)
            .catch(noop);
        if (!provider) {
            traceWarning(
                `Extension may have been uninstalled for provider ${kernel.serverProviderHandle.id}, handle ${kernel.serverProviderHandle.handle}`
            );
            return false;
        }
        if (provider.getHandles) {
            const handles = await provider.getHandles();
            if (handles.includes(kernel.serverProviderHandle.handle)) {
                return true;
            } else {
                traceWarning(
                    `Hiding remote kernel ${kernel.id} for ${provider.id} as the remote Jupyter Server ${kernel.serverProviderHandle.id}:${kernel.serverProviderHandle.handle} is no longer available`
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
