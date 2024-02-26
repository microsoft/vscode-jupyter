// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Event, NotebookCellOutput } from 'vscode';

declare module './api' {
    /**
     * Represents a Jupyter Kernel.
     */
    export interface Kernel {
        /**
         * Event that fires when a display_update message is sent, one that
         * belongs to a display output from a previous code execution call.
         * This allows 3rd party extensions to send messages from the kernel back to the extension host
         * even after the code execution has completed.
         * E.g. via background threads.
         */
        onDidRecieveDisplayUpdate: Event<NotebookCellOutput>;
    }
}
