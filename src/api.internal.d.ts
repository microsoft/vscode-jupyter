// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// The following is required to make sure the types are merged correctly.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { CancellationToken } from 'vscode';

// These types are only used internally within the extension.
// Never to be exposed to other extensions.
// Could also contain proposed API that is used internally and not exposed to other extensions.

declare module './api' {
    export interface JupyterServer {
        /**
         * Display a `trash` icon next to each server in the quick pick.
         * Allowing the user to remove this server.
         * Currently used only by the Jupyter Extension.
         * A better more generic way to deal with this would be via commands.
         */
        remove?(): Promise<void>;
    }
    export interface JupyterServerCollection {
        /**
         * Internally used by Jupyter extension to track the extension that created this server.
         */
        readonly extensionId: string;
    }

    export interface IJupyterUriProvider {
        getServerUriWithoutAuthInfo?(handle: string): Promise<IJupyterServerUri>;
        readonly extensionId: string;
    }
}
