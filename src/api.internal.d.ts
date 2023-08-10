// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri } from 'vscode';

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
        /**
         * Link to documentation for this provider.
         * Used internally to display the link for `Existing Jupyter Servers` in the quick pick.
         */
        documentation?: Uri;
        /**
         * Ability to retrieve the displayName without having to get the auth information.
         * Only used internally when we need the displayName.
         * The getServerUri could end up prompting for username/password when connecting to the remote servers.
         */
        getServerUriWithoutAuthInfo?(handle: string): Promise<IJupyterServerUri>;
        /**
         * Internally used by Jupyter extension to track the extension that owns this provider.
         */
        readonly extensionId: string;
    }
}
