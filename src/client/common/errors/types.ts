// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { EOL } from 'os';

export abstract class BaseError extends Error {
    public stdErr?: string;
    constructor(public readonly category: ErrorCategory, message: string) {
        super(message);
    }
}

/**
 * Wraps an error with a custom error message, retaining the call stack information.
 */
export class WrappedError extends BaseError {
    constructor(message: string, public readonly originalException?: Error) {
        super(getErrorCategory(originalException), message);
        if (originalException) {
            // Retain call stack that trapped the error and rethrows this error.
            // Also retain the call stack of the original error.
            this.stack = `${new Error('').stack}${EOL}${EOL}${originalException.stack}`;
        }
    }
}

export function getErrorCategory(error?: Error): ErrorCategory {
    if (!error) {
        return 'unknown';
    }
    return error instanceof BaseError ? error.category : 'unknown';
}

export type ErrorCategory =
    | 'cancelled'
    | 'timeout'
    | 'daemon'
    | 'zmq'
    | 'debugger'
    | 'kerneldied'
    | 'kerneldied'
    | 'kernelpromisetimeout'
    | 'jupytersession'
    | 'jupyterconnection'
    | 'jupyterinstall'
    | 'jupyterselfcert'
    | 'invalidkernel'
    | 'noipykernel'
    | 'fetcherror'
    | 'notinstalled'
    | 'unknown';

// If there are errors, then the are added to the telementry properties.
export type TelemetryErrorProperties = {
    failed: true;
    /**
     * Node stacktrace without PII.
     */
    stackTrace: string;
    /**
     * A reason that we generate (e.g. kerneldied, noipykernel, etc), more like a category of the error.
     */
    failureCategory?: string;
    /**
     * Further sub classification of the error. E.g. kernel died due to the fact that zmq is not installed properly.
     */
    failureSubCategory?: string;
    /**
     * Hash of the file name that contains the file in the last frame (from Python stack trace).
     */
    pythonErrorFile?: string;
    /**
     * Hash of the folder that contains the file in the last frame (from Python stack trace).
     */
    pythonErrorFolder?: string;
    /**
     * Hash of the module that contains the file in the last frame (from Python stack trace).
     */
    pythonErrorPackage?: string;
};
