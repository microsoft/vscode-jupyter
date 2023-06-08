// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

let messageLogger: undefined | ((category: 'error' | 'verbose', message: string) => void);
export function logMessage(message: string) {
    if (messageLogger) {
        messageLogger('verbose', message);
    }
}
export function logErrorMessage(message: string) {
    if (messageLogger) {
        messageLogger('error', message);
    }
}

export function setLogger(logger: (category: 'error' | 'verbose', message: string) => void) {
    messageLogger = logger;
}
