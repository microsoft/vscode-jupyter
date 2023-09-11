// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// https://github.com/microsoft/vscode-jupyter/issues/13893

import type { Session } from '@jupyterlab/services';
import type { CancellationToken, Uri } from 'vscode';

declare module './api' {
    export interface JupyterServerProvider {
        /**
         * Invoked after a kernel has been started, allowing the contributing extension to perform startup
         * actions on the kernel.
         * This is only invoked for kernels
         * - That belong to {@link JupyterServer JupyterServers} contributed by this provider.
         * - That have been started, not for connecting to already started (active) kernels
         *
         * Note: This operation affects the over all startup time of a kernel, which could adversely impact the UX.
         * Please ensure this operation is fast.
         *
         * @param uri The Uri of the resource associated with the kernel.
         * In the case of Jupyter Notebooks and Interactive Window, this is the Uri of the Notebook.
         * @session The {@link Session.ISessionConnection Session Connection} for the Kernel. Use this to communicate with the backend kernel.
         */
        onStartKernel?(
            data: { uri: Uri; server: JupyterServer; session: Session.ISessionConnection },
            token: CancellationToken
        ): Promise<void>;
    }
}
