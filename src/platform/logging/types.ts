// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-explicit-any */

export type Arguments = unknown[];

export interface ILogger {
    error(message: string, ...data: Arguments): void;
    warn(message: string, ...data: Arguments): void;
    info(message: string, ...data: Arguments): void;
    debug(message: string, ...data: Arguments): void;
    trace(message: string, ...data: Arguments): void;
    ci(msg: () => [message: string, ...args: string[]] | string): void;
    ci(message: string, ...args: string[]): void;
    ci(arg1: any, ...args: Arguments): void;
}

export type TraceDecoratorType = (
    _: Object,
    __: string,
    descriptor: TypedPropertyDescriptor<any>
) => TypedPropertyDescriptor<any>;

// The information we want to log.
export enum TraceOptions {
    None = 0,
    Arguments = 1,
    ReturnValue = 2,
    /**
     * Default is to log after a method call.
     * This allows logging of the method call before it is done.
     */
    BeforeCall = 4
}

export enum ConsoleForegroundColors {
    Green = '\x1b[32m',
    Red = `\x1b[31m`
}
