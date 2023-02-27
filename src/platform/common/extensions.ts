// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-unused-vars
declare interface Promise<T> {
    /**
     * Catches task error and ignores them.
     */
    ignoreErrors(): void;
}

/**
 * Explicitly tells that promise should be run asynchonously.
 */
Promise.prototype.ignoreErrors = function <T>(this: Promise<T>) {
    // eslint-disable-next-line no-empty, @typescript-eslint/no-empty-function
    this.catch(() => {});
};
