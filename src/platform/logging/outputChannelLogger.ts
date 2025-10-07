// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { LogOutputChannel } from 'vscode';
import { Arguments, ILogger } from './types';

const format = require('format-util') as typeof import('format-util');

export class OutputChannelLogger implements ILogger {
    private readonly homeReplaceRegEx?: RegExp;
    private readonly userNameReplaceRegEx?: RegExp;
    constructor(
        private readonly channel: LogOutputChannel,
        homeRegEx?: RegExp,
        userNameRegEx?: RegExp
    ) {
        this.homeReplaceRegEx = homeRegEx;
        this.userNameReplaceRegEx = userNameRegEx;
    }
    private format(message: string, ...data: Arguments) {
        let logMessage = format(message, ...data);
        if (this.homeReplaceRegEx) {
            logMessage = logMessage.replace(this.homeReplaceRegEx, '~');
        }
        if (this.userNameReplaceRegEx) {
            logMessage = logMessage.replace(this.userNameReplaceRegEx, '<username>');
        }
        return logMessage;
    }

    public error(message: string, ...data: Arguments): void {
        this.channel.error(this.format(message, ...data));
    }

    public warn(message: string, ...data: Arguments): void {
        this.channel.warn(this.format(message, ...data));
    }

    public info(message: string, ...data: Arguments): void {
        this.channel.info(this.format(message, ...data));
    }

    public debug(message: string, ...data: Arguments): void {
        this.channel.debug(this.format(message, ...data));
    }

    public trace(message: string, ...data: Arguments): void {
        this.channel.trace(this.format(message, ...data));
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public ci(_message: any, ..._data: Arguments): void {
        //
    }
}
