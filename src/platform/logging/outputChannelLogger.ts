// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { OutputChannel } from 'vscode';
import { Arguments, ILogger } from './types';
import { getTimeForLogging } from './util';

const format = require('format-util') as typeof import('format-util');

export class OutputChannelLogger implements ILogger {
    private readonly homeReplaceRegEx?: RegExp;
    private readonly userNameReplaceRegEx?: RegExp;
    constructor(private readonly channel: OutputChannel, home?: string, userName?: string) {
        this.homeReplaceRegEx = home ? new RegExp(home, 'ig') : undefined;
        this.userNameReplaceRegEx = userName ? new RegExp(userName, 'ig') : undefined;
    }
    private format(level: string | undefined, message: string, ...data: Arguments) {
        let logMessage = level
            ? `${getTimeForLogging()} [${level}] ${format(message, ...data)}`
            : format(message, ...data);
        if (this.homeReplaceRegEx) {
            logMessage = logMessage.replace(this.homeReplaceRegEx, '~');
        }
        if (this.userNameReplaceRegEx) {
            logMessage = logMessage.replace(this.userNameReplaceRegEx, '<username>');
        }
        return logMessage;
    }

    public traceLog(message: string, ...data: Arguments): void {
        this.channel.appendLine(this.format('', message, ...data));
    }

    public traceError(message: string, ...data: Arguments): void {
        this.channel.appendLine(this.format('error', message, ...data));
    }

    public traceWarn(message: string, ...data: Arguments): void {
        this.channel.appendLine(this.format('warn', message, ...data));
    }

    public traceInfo(message: string, ...data: Arguments): void {
        this.channel.appendLine(this.format('info', message, ...data));
    }

    public traceVerbose(message: string, ...data: Arguments): void {
        this.channel.appendLine(this.format('debug', message, ...data));
    }
}
