// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    Disposable,
    Event,
    QuickPickItem} from 'vscode';

declare module './api' {
    export interface Jupyter {
        /**
         * Registers a remote server provider component that's used to pick remote jupyter server URIs
         * @param serverProvider object called back when picking jupyter server URI
         */
        registerRemoteServerProvider(serverProvider: IJupyterUriProvider): Disposable;
        /**
         * Adds a remote Jupyter Server to the list of Remote Jupyter servers.
         * This will result in the Jupyter extension listing kernels from this server as items in the kernel picker.
         */
        addRemoteJupyterServer(providerId: string, handle: string): Promise<void>;
    }
    //#region Jupyter Server Providers
    export interface IJupyterServerUri {
        baseUrl: string;
        /**
         * Jupyter auth Token
         */
        token: string;
        /**
         * Authorization header to be used when connecting to the server.
         */
        authorizationHeader?: Record<string, string>;
        displayName: string;
        /**
         * The local directory that maps to the remote directory of the Jupyter Server.
         * E.g. assume you start Jupyter Notebook with --notebook-dir=/foo/bar,
         * and you have a file named /foo/bar/sample.ipynb, /foo/bar/sample2.ipynb and the like.
         * Then assume the mapped local directory will be /users/xyz/remoteServer and the files sample.ipynb and sample2.ipynb
         * are in the above local directory.
         *
         * Using this setting one can map the local directory to the remote directory.
         * In this case the value of this property would be /users/xyz/remoteServer.
         *
         * Note: A side effect of providing this value is the session names are generated the way they are in Jupyter Notebook/Lab.
         * I.e. the session names map to the relative path of the notebook file.
         * As a result when attempting to create a new session for a notebook/file, Jupyter will
         * first check if a session already exists for the same file and same kernel, and if so, will re-use that session.
         */
        mappedRemoteNotebookDir?: string;
        /**
         * Returns the sub-protocols to be used. See details of `protocols` here https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/WebSocket
         * Useful if there is a custom authentication scheme that needs to be used for WebSocket connections.
         * Note: The client side npm package @jupyterlab/services uses WebSockets to connect to remote Kernels.
         */
        webSocketProtocols?: string[];
        /**
         * The `fetch` method to use.
         */
        readonly fetch?: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
        /**
         * The `WebSocket` object constructor.
         */
        readonly WebSocket?: typeof WebSocket;
    }

    export interface IJupyterUriProvider {
        /**
         * Should be a unique string (like a guid)
         */
        readonly id: string;
        readonly displayName?: string;
        readonly detail?: string;
        onDidChangeHandles?: Event<void>;
        getQuickPickEntryItems?():
            | Promise<
                  (QuickPickItem & {
                      /**
                       * If this is the only quick pick item in the list and this is true, then this item will be selected by default.
                       */
                      default?: boolean;
                  })[]
              >
            | (QuickPickItem & {
                  /**
                   * If this is the only quick pick item in the list and this is true, then this item will be selected by default.
                   */
                  default?: boolean;
              })[];
        /**
         * @param item The original quick Pick returned by getQuickPickEntryItems will be passed into this method.
         */
        handleQuickPick?(item: QuickPickItem, backEnabled: boolean): Promise<string | 'back' | undefined>;
        /**
         * Given the handle, returns the Jupyter Server information.
         */
        getServerUri(handle: string): Promise<IJupyterServerUri>;
        /**
         * Gets a list of all valid Jupyter Server handles that can be passed into the `getServerUri` method.
         */
        getHandles?(): Promise<string[]>;
    }
    //#endregion
}
