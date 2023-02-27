// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * @typedef {Object} SplitLinesOptions
 * @property {boolean} [trim=true] - Whether to trim the lines.
 * @property {boolean} [removeEmptyEntries=true] - Whether to remove empty entries.
 */

// https://stackoverflow.com/questions/39877156/how-to-extend-string-prototype-and-use-it-next-in-typescript
// eslint-disable-next-line @typescript-eslint/naming-convention
declare interface String {
    /**
     * Appropriately formats a string so it can be used as an argument for a command in a shell.
     * E.g. if an argument contains a space, then it will be enclosed within double quotes.
     */
    toCommandArgument(): string;
    /**
     * Appropriately formats a a file path so it can be used as an argument for a command in a shell.
     * E.g. if an argument contains a space, then it will be enclosed within double quotes.
     */
    fileToCommandArgument(): string;
    /**
     * String.trimQuotes implementation
     * Removes leading and trailing quotes from a string
     */
    trimQuotes(): string;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
declare interface Promise<T> {
    /**
     * Catches task errors and ignores them.
     */
    ignoreErrors(): void;
}
