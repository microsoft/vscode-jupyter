// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

const FgYellow = '\x1b[33m';
export function logMessage(message: string) {
    // Change foreground color so its easy to pick messages from UI
    // I.e. when looking at debugger console window (Toggle Dev Tools), it'll be easy to spot messages logged in UI vs extension.
    console.log(`${FgYellow}${message}`);
}
