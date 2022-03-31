// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { createWriteStream } from 'fs-extra';
import { logTo, registerLogger } from '../platform/logging';
import { FileLogger } from '../platform/logging/fileLogger.node';
import { LogLevel } from '../platform/logging/types';

// IMPORTANT: This file should only be importing from the '../platform/logging' directory, as we
// delete everything in '../platform' except for '../platform/logging' before running smoke tests.

const isCI = process.env.TF_BUILD !== undefined || process.env.GITHUB_ACTIONS === 'true';
export function getPreDefinedConfiguration() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config: any = {};

    // Do not log to console if running tests and we're not
    // asked to do so.
    if (process.env.VSC_JUPYTER_FORCE_LOGGING) {
        config.console = {};
        // In CI there's no need for the label.
        const isCI = process.env.TF_BUILD !== undefined || process.env.GITHUB_ACTIONS === 'true';
        if (!isCI) {
            config.console.label = 'Jupyter Extension:';
        }
    }
    if (process.env.VSC_JUPYTER_LOG_FILE) {
        config.file = {
            logfile: process.env.VSC_JUPYTER_LOG_FILE
        };
    }
    return config;
}

export function initializeLogger() {
    const config = getPreDefinedConfiguration();
    if (isCI && process.env.VSC_JUPYTER_LOG_FILE) {
        delete config.console;
        // This is a separate logger that matches our config but
        // does not do any console logging.
        const fileLogger = new FileLogger(createWriteStream(process.env.VSC_JUPYTER_LOG_FILE));
        registerLogger(fileLogger);
        // Send console.*() to the non-console loggers.
        monkeypatchConsole();
    }
}

/**
 * What we're doing here is monkey patching the console.log so we can
 * send everything sent to console window into our logs.  This is only
 * required when we're directly writing to `console.log` or not using
 * our `winston logger`.  This is something we'd generally turn on only
 * on CI so we can see everything logged to the console window
 * (via the logs).
 */
function monkeypatchConsole() {
    // The logging "streams" (methods) of the node console.
    const streams = ['log', 'error', 'warn', 'info', 'debug', 'trace'];
    const levels: { [key: string]: LogLevel } = {
        error: LogLevel.Error,
        warn: LogLevel.Warn
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const consoleAny: any = console;
    for (const stream of streams) {
        // Using symbols guarantee the properties will be unique & prevents
        // clashing with names other code/library may create or have created.
        // We could use a closure but it's a bit trickier.
        const sym = Symbol.for(stream);
        consoleAny[sym] = consoleAny[stream];
        // eslint-disable-next-line
        consoleAny[stream] = function () {
            const args = Array.prototype.slice.call(arguments);
            const fn = consoleAny[sym];
            fn(...args);
            const level = levels[stream] || LogLevel.Info;
            logTo(level, args[0], args.length > 0 ? args.slice(1) : []);
        };
    }
}
