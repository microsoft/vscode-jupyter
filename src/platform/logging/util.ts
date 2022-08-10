// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Arguments = any[];

function valueToLogString(value: unknown, kind: string): string {
    if (Array.isArray(value)) {
        return value.map((item) => valueToLogString(item, kind)).join(', ');
    }
    if (value === undefined) {
        return 'undefined';
    }
    if (value === null) {
        return 'null';
    }
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (value && (value as any).path) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return `<Uri:${(value as any).path}>`;
        }
        return JSON.stringify(value);
    } catch {
        return `<${kind} cannot be serialized for logging>`;
    }
}

// Convert the given array of values (func call arguments) into a string
// suitable to be used in a log message.
export function argsToLogString(args: Arguments): string {
    if (!args) {
        return '';
    }
    try {
        const argStrings = args.map((item, index) => {
            const valueString = valueToLogString(item, 'argument');
            return `Arg ${index + 1}: ${valueString}`;
        });
        return argStrings.join(', ');
    } catch {
        return '';
    }
}

// Convert the given return value into a string
// suitable to be used in a log message.
export function returnValueToLogString(returnValue: unknown): string {
    const valueString = valueToLogString(returnValue, 'Return value');
    return `Return Value: ${valueString}`;
}
export function getTimeForLogging(): string {
    const date = new Date();
    return `${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}.${date.getMilliseconds()}`;
}
