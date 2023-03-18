// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { window } from 'vscode';
import { IDisposableRegistry, IOutputChannel } from '../../platform/common/types';
import * as localize from '../../platform/common/utils/localize';
import { traceVerbose } from '../../platform/logging';

/**
 * Returns the output panel for output related to Jupyter Server.
 */
export function getJupyterOutputChannel(disposables: IDisposableRegistry): IOutputChannel {
    const jupyterServerOutputChannel = window.createOutputChannel(
        localize.DataScience.jupyterServerConsoleOutputChannel,
        'log'
    );
    disposables.push(jupyterServerOutputChannel);
    const handler: ProxyHandler<IOutputChannel> = {
        get(target: IOutputChannel, propKey: keyof IOutputChannel) {
            const method = target[propKey];
            if (typeof method === 'function') {
                if (propKey === 'append') {
                    return (...args: Parameters<IOutputChannel['append']>) => {
                        jupyterServerOutputChannel.append(...args);
                        traceVerbose(...args);
                    };
                }
                if (propKey === 'appendLine') {
                    return (...args: Parameters<IOutputChannel['appendLine']>) => {
                        jupyterServerOutputChannel.appendLine(...args);
                        traceVerbose(...args);
                    };
                }
            }
            return method;
        }
    };
    return new Proxy(jupyterServerOutputChannel, handler);
}
