// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Uri } from 'vscode';

declare module './api' {
    export interface JupyterServer {
        /**
         * Note: Required for AzML, perhaps CodeSpaces and Pengs personal extension.
         *
         * The local directory that maps to the remote directory of the Jupyter Server.
         * E.g. assume you start Jupyter Notebook on a remote machine with --notebook-dir=/foo/bar,
         * and you have a file named /foo/bar/sample.ipynb, /foo/bar/sample2.ipynb and the like.
         * Next assume you have local directory named /users/xyz/remoteServer with the files with the same names, sample.ipynb and sample2.ipynb
         *
         *
         * Using this setting one can map the local directory to the remote directory.
         * With the previous example in mind, the value of this property would be Uri.file('/users/xyz/remoteServer').
         *
         * This results in Jupyter Session names being generated in a way thats is consistent with Jupyter Notebook/Lab.
         * I.e. the session names map to the relative path of the notebook file.
         * Taking the previous example into account, if one were to start a Remote Kernel for the local file `/users/xyz/remoteServer/sample2.ipynb`,
         * then the name of the remote Jupyter Session would be `sample2.ipynb`.
         *
         * This is useful in the context where the remote Jupyter Server is running on the same machine as VS Code, but the files are mapped on different directories.
         */
        readonly mappedRemoteDirectory?: Uri;
    }
}
