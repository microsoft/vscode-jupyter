// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const log = require('why-is-node-running');

// Call this function to debug async hangs. It should print out stack traces of still running promises.
export function asyncDump() {
    log();
}
