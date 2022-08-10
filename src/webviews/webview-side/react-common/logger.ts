// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

let messageLogger: undefined | ((message: string) => void);
export function logMessage(message: string) {
    if (messageLogger) {
        messageLogger(message);
    }
}

export function setLogger(logger: (message: string) => void) {
    messageLogger = logger;
}
