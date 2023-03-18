// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { OutputChannel } from 'vscode';
import { Arguments, ILogger } from './types';
import { getTimeForLogging } from './util';
const format = require('format-util') as typeof import('format-util');

function formatMessage(level: string | undefined, message: string, ...data: Arguments): string {
    return level ? `${getTimeForLogging()} [${level}] ${format(message, ...data)}` : format(message, ...data);
}

export class OutputChannelLogger implements ILogger {
    constructor(private readonly channel: OutputChannel) {}

    public traceLog(message: string, ...data: Arguments): void {
        this.channel.appendLine(format(message, ...data));
    }

    public traceError(message: string, ...data: Arguments): void {
        this.channel.appendLine(formatMessage('error', message, ...data));
    }

    public traceWarn(message: string, ...data: Arguments): void {
        this.channel.appendLine(formatMessage('warn', message, ...data));
    }

    public traceInfo(message: string, ...data: Arguments): void {
        this.channel.appendLine(formatMessage('info', message, ...data));
    }

    public traceVerbose(message: string, ...data: Arguments): void {
        this.channel.appendLine(formatMessage('debug', message, ...data));
    }
    public traceEverything(message: string, ...data: Arguments): void {
        this.channel.appendLine(formatMessage('everything', message, ...data));
    }
}
