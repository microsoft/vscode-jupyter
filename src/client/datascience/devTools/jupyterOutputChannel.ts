// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { window } from 'vscode';
import { IOutputChannel } from '../../common/types';

/**
 * Returns the output panel for output related to Jupyter Server.
 */
export function getJupyterOutputChannel(isDevMode: boolean, defaultOutputChannel: IOutputChannel): IOutputChannel {
    if (!isDevMode) {
        return defaultOutputChannel;
    }
    // This isn't added to list of disposables, that should be fine (only used in dev mode).
    const jupyterServerOutputChannel = window.createOutputChannel('Dev: Jupyter Server');
    const handler: ProxyHandler<IOutputChannel> = {
        get(target: IOutputChannel, propKey: keyof IOutputChannel) {
            const method = target[propKey];
            if (typeof method === 'function') {
                if (propKey === 'append') {
                    return (...args: Parameters<IOutputChannel['append']>) => {
                        jupyterServerOutputChannel.append(...args);
                        return defaultOutputChannel.append(...args);
                    };
                }
                if (propKey === 'appendLine') {
                    return (...args: Parameters<IOutputChannel['appendLine']>) => {
                        jupyterServerOutputChannel.appendLine(...args);
                        return defaultOutputChannel.appendLine(...args);
                    };
                }
            }
            return method;
        }
    };
    return new Proxy(defaultOutputChannel, handler);
}
