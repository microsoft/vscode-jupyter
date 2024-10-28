// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Arguments, ILogger } from './types';
import { getTimeForLogging } from './util';
const format = require('format-util') as typeof import('format-util');

function formatMessage(level: string | undefined, message: string, ...data: Arguments): string {
    const isDataEmpty = [...data].length === 0;
    const formattedMessage = isDataEmpty ? format(message) : format(message, ...data);
    return level ? `${level} ${getTimeForLogging()}: ${formattedMessage}` : formattedMessage;
}

export class ConsoleLogger implements ILogger {
    constructor(private readonly prefix: string | undefined) {}

    public error(message: string, ...data: Arguments): void {
        console.error(formatMessage('error', `${this.prefix || ''} ${message}`, ...data));
    }

    public warn(message: string, ...data: Arguments): void {
        console.warn(formatMessage('warn', `${this.prefix || ''} ${message}`, ...data));
    }

    public info(message: string, ...data: Arguments): void {
        console.info(formatMessage('info', `${this.prefix || ''} ${message}`, ...data));
    }

    public debug(message: string, ...data: Arguments): void {
        console.log(formatMessage('debug', `${this.prefix || ''} ${message}`, ...data));
    }
    public trace(message: string, ...data: Arguments): void {
        console.trace(formatMessage('trace', `${this.prefix || ''} ${message}`, ...data));
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public ci(_message: any, ..._data: Arguments): void {
        //
    }
}
