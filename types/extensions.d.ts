// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// eslint-disable-next-line @typescript-eslint/naming-convention
declare interface Promise<T> {
    /**
     * Catches task errors and ignores them.
     */
    ignoreErrors(): void;
}
