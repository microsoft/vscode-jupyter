// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Event, Uri } from 'vscode';

declare module './api' {
    /**
     * These types are not required for any other extension, except for the Python extension.
     * Hence the reason to keep this separate. This way we can keep the API stable for other extensions (which would be the majority case).
     */
    export interface Jupyter {
        /**
         * This event is triggered when the environment associated with a Jupyter Notebook or Interactive Window changes.
         * The Uri in the event is the Uri of the Notebook/IW.
         */
        onDidChangePythonEnvironment: Event<Uri>;
        /**
         * Returns the EnvironmentPath to the Python environment associated with a Jupyter Notebook or Interactive Window.
         * If the Uri is not associated with a Jupyter Notebook or Interactive Window, then this method returns undefined.
         * @param uri
         */
        getPythonEnvironment(uri: Uri):
            | undefined
            | {
                  /**
                   * The ID of the environment.
                   */
                  readonly id: string;
                  /**
                   * Path to environment folder or path to python executable that uniquely identifies an environment. Environments
                   * lacking a python executable are identified by environment folder paths, whereas other envs can be identified
                   * using python executable path.
                   */
                  readonly path: string;
              };
    }
}
