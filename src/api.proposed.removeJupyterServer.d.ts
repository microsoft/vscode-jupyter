// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Uri } from 'vscode';

declare module './api' {
    export interface JupyterServerProvider {
        /**
         * Note: For Internal Jupyter Server Provider and JupyterHub extension.
         * Ability to remove a Jupyter server is internal to the Jupyter Extension & Jupyter Hub extension.
         *
         * Display a `trash` icon next to each server in the quick pick.
         * Allowing the user to remove this server.
         * Currently used only by the Jupyter Extension.
         * A better more generic way to deal with this would be via commands.
         */
        removeJupyterServer?(server: JupyterServer): Promise<void>;
    }
}
