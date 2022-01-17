// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

let messageLogger: undefined | ((message: string) => void);
const FgYellow = '\x1b[33m';
export function logMessage(message: string) {
    // Change foreground color so its easy to pick messages from UI
    // I.e. when looking at debugger console window (Toggle Dev Tools), it'll be easy to spot messages logged in UI vs extension.
    console.log(`${FgYellow}${message}`);
    if (messageLogger) {
        messageLogger(message);
    }
}
/**
 * Logging in production seems to slow down webview (unnecessarily too chatty)
 */
export function logMessageOnlyOnCI(message: string) {
    if (
        process.env.VSC_JUPYTER_FORCE_LOGGING ||
        process.env.TF_BUILD !== undefined ||
        process.env.GITHUB_ACTIONS === 'true'
    ) {
        // Change foreground color so its easy to pick messages from UI
        // I.e. when looking at debugger console window (Toggle Dev Tools), it'll be easy to spot messages logged in UI vs extension.
        console.log(`${FgYellow}${message}`);
    }
    if (messageLogger) {
        messageLogger(message);
    }
}

export function setLogger(logger: (message: string) => void) {
    messageLogger = logger;
}
