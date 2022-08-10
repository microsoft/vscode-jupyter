// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-explicit-any */

export enum LogLevel {
    // Larger numbers are higher priority.
    Error = 40,
    Warn = 30,
    Info = 20,
    Debug = 10,
    Trace = 5,
    Everything = 1,
    Off = 100
}

export type Arguments = unknown[];

export interface ILogger {
    traceLog(message: string, ...data: Arguments): void;
    traceError(message: string, ...data: Arguments): void;
    traceWarn(message: string, ...data: Arguments): void;
    traceInfo(message: string, ...data: Arguments): void;
    traceEverything(message: string, ...data: Arguments): void;
    traceVerbose(message: string, ...data: Arguments): void;
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
