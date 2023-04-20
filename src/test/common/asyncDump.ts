// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Call this function to debug async hangs. It should print out stack traces of still running promises.
export function asyncDump() {
    require('why-is-node-running')();
}
