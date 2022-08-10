// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WriteStream } from 'fs-extra';
import * as util from 'util';
import { Disposable } from 'vscode-jsonrpc';
import { Arguments, ILogger } from './types';
import { getTimeForLogging } from './util';

function formatMessage(level?: string, ...data: Arguments): string {
    return level ? `${level} ${getTimeForLogging()}: ${util.format(...data)}\r\n` : `${util.format(...data)}\r\n`;
}

export class FileLogger implements ILogger, Disposable {
    constructor(private readonly stream: WriteStream) {}

    public traceLog(...data: Arguments): void {
        this.stream.write(formatMessage(undefined, ...data));
    }

    public traceError(...data: Arguments): void {
        this.stream.write(formatMessage('error', ...data));
    }

    public traceWarn(...data: Arguments): void {
        this.stream.write(formatMessage('warn', ...data));
    }

    public traceInfo(...data: Arguments): void {
        this.stream.write(formatMessage('info', ...data));
    }

    public traceVerbose(...data: Arguments): void {
        this.stream.write(formatMessage('debug', ...data));
    }

    public traceEverything(...data: Arguments): void {
        this.stream.write(formatMessage('everything', ...data));
    }

    public dispose(): void {
        try {
            this.stream.close();
        } catch (ex) {
            /** do nothing */
        }
    }
}
