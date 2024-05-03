// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { OutputChannel } from 'vscode';
import { Arguments, ILogger } from './types';
import { getTimeForLogging } from './util';

const format = require('format-util') as typeof import('format-util');

export class OutputChannelLogger implements ILogger {
    private readonly homeReplaceRegEx?: RegExp;
    private readonly userNameReplaceRegEx?: RegExp;
    constructor(
        private readonly channel: OutputChannel,
        homeRegEx?: RegExp,
        userNameRegEx?: RegExp
    ) {
        this.homeReplaceRegEx = homeRegEx;
        this.userNameReplaceRegEx = userNameRegEx;
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

    public error(message: string, ...data: Arguments): void {
        this.channel.appendLine(this.format('error', message, ...data));
    }

    public warn(message: string, ...data: Arguments): void {
        this.channel.appendLine(this.format('warn', message, ...data));
    }

    public info(message: string, ...data: Arguments): void {
        this.channel.appendLine(this.format('info', message, ...data));
    }

    public debug(message: string, ...data: Arguments): void {
        this.channel.appendLine(this.format('debug', message, ...data));
    }

    public trace(message: string, ...data: Arguments): void {
        this.channel.appendLine(this.format('trace', message, ...data));
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public ci(_message: any, ..._data: Arguments): void {
        //
    }
}
