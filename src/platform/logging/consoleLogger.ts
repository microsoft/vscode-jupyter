// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Arguments, ILogger } from './types';
import { getTimeForLogging } from './util';
const format = require('format-util') as typeof import('format-util');

function formatMessage(level: string | undefined, message: string, ...data: Arguments): string {
    return level ? `${level} ${getTimeForLogging()}: ${format(message, ...data)}` : format(message, ...data);
}

export class ConsoleLogger implements ILogger {
    constructor(private readonly prefix: string | undefined) {}

    public traceLog(message: string, ...data: Arguments): void {
        console.log(format(`${this.prefix || ''} ${message}`, ...data));
    }

    public traceError(message: string, ...data: Arguments): void {
        console.error(formatMessage('error', `${this.prefix || ''} ${message}`, ...data));
    }

    public traceWarn(message: string, ...data: Arguments): void {
        console.warn(formatMessage('warn', `${this.prefix || ''} ${message}`, ...data));
    }

    public traceInfo(message: string, ...data: Arguments): void {
        console.info(formatMessage('info', `${this.prefix || ''} ${message}`, ...data));
    }

    public traceVerbose(message: string, ...data: Arguments): void {
        console.log(formatMessage('verbose', `${this.prefix || ''} ${message}`, ...data));
    }

    public traceEverything(message: string, ...data: Arguments): void {
        console.log(formatMessage('everything', `${this.prefix || ''} ${message}`, ...data));
    }
}
