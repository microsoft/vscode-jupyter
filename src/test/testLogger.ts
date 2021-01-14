// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

// IMPORTANT: This file should only be importing from the '../client/logging' directory, as we
// delete everything in '../client' except for '../client/logging' before running smoke tests.

import { LogLevel } from '../client/logging/levels';
import { configureLogger, createLogger, getPreDefinedConfiguration, logToAll } from '../client/logging/logger';

const isCI = process.env.TF_BUILD !== undefined || process.env.GITHUB_ACTIONS === 'true';
const monkeyPatchLogger = createLogger();

export function initializeLogger() {
    const config = getPreDefinedConfiguration();
    if (isCI && process.env.VSC_JUPYTER_LOG_FILE) {
        delete config.console;
        // This is a separate logger that matches our config but
        // does not do any console logging.
        configureLogger(monkeyPatchLogger, config);
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
            logToAll([monkeyPatchLogger], level, args);
        };
    }
}
