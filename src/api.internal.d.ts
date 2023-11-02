// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Event, Uri } from 'vscode';

// These types are only used internally within the extension.
// Never to be exposed to other extensions.
// Could also contain proposed API that is used internally and not exposed to other extensions.

declare module './api' {
    export interface JupyterServerCollection {
        /**
         * Internally used by Jupyter extension to track the extension that created this server.
         */
        readonly extensionId: string;
        /**
         * Used internally by Jupyter Extension to detect changes to the JupyterServerProvider.
         */
        onDidChangeProvider: Event<void>;
        /**
         * Used internal by Jupyter extension to tarck the Server Provider.
         */
        readonly serverProvider: JupyterServerProvider;
    }
    export interface IJupyterUriProvider {
        /**
         * Link to documentation for this provider.
         * Used internally to display the link for `Existing Jupyter Servers` in the quick pick.
         */
        documentation?: Uri;
    }
}
