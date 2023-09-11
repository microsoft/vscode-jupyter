// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri } from 'vscode';

declare module './api' {
    export interface JupyterServerCommandProvider {
        /**
         * Returns a list of commands to be displayed to the user.
         * @deprecated Use `provideCommands` instead.
         */
        commands?: JupyterServerCommand[];
    }

    export interface JupyterServerCommand {
        /**
         * @deprecated Use `label` instead.
         */
        title?: string;
        /**
         * @deprecated Use `description` instead.
         */
        detail?: string;
    }
}
