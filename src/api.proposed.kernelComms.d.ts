// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CancellationToken, Event } from 'vscode';

declare module './api' {
    /**
     * Represents a Jupyter Kernel.
     */
    export interface Kernel {
        /**
         * Creates a new comm target providing a bidirectional communication between the extension host and the Kernel.
         * Resolves when the Kernel establishes a connection.
         *
         * Once this method has been invoked, use the following sample python code to connect to this target:
         * ```python
         * from comm import create_comm
         *
         * comm = create_comm(target_name='donjayamanne.vscode-jupyter-comms-api-client')
         * comm.send({'foo': 2}) # Send a message to the extension
         *
         * @comm.on_msg
         * def _recv(msg):
         *     # Receive messages from the extension
         *     content = msg['content']['data']
         *     buffers = msg['buffers']
         *
         * @comm.on_close
         * def _closed(msg):
         *     pass
         * ```
         */
        createCommTarget(token: CancellationToken): Promise<{
            /**
             * Whether the comm channel has been disposed.
             */
            readonly isDisposed: boolean;
            /**
             * Fired when the comm channel has been disposed.
             * This can get fired when the Kernel closes the target.
             */
            onDidDispose: Event<void>;
            /**
             * Disposes the comm channel.
             */
            dispose(): void;
            /**
             * Fired when a message is received from the Kernel.
             */
            onMessage: Event<{
                /**
                 * A JSON serializable piece of data to be sent to the kernel.
                 */
                data: unknown;
            }>;
            /**
             * Sends a message to the Kernel.
             */
            send(data: unknown): void;
        }>;
    }
}
