// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { window, workspace } from 'vscode';
import { IDisposableRegistry, IOutputChannel } from '../../platform/common/types';
import * as localize from '../../platform/common/utils/localize';

/**
 * Returns the output panel for output related to Jupyter Server.
 */
export function getJupyterOutputChannel(
    isDevMode: boolean,
    disposables: IDisposableRegistry,
    defaultOutputChannel: IOutputChannel
): IOutputChannel {
    const forceLog = workspace.getConfiguration('jupyter').get('logKernelOutputSeparately', false);
    if (!isDevMode && !forceLog) {
        return defaultOutputChannel;
    }
    const jupyterServerOutputChannel = window.createOutputChannel(
        localize.DataScience.jupyterServerConsoleOutputChannel()
    );
    disposables.push(jupyterServerOutputChannel);
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
