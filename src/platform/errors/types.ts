// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Base class for all errors that we send telemetry about.
 *
 * @category - What type of error it is. Sent in telemetry data
 */
export abstract class BaseError extends Error {
    public stdErr?: string;
    public isJupyterError = true;
    constructor(
        public readonly category: ErrorCategory,
        message: string
    ) {
        super(message);
    }
}

/**
 * Wraps an error with a custom error message, retaining the call stack information.
 */
export class WrappedError extends BaseError {
    constructor(
        message: string,
        public readonly originalException?: Error,
        category?: ErrorCategory
    ) {
        super(category || getErrorCategory(originalException), message);
        if (originalException) {
            // Retain call stack that trapped the error and rethrows this error.
            // Also retain the call stack of the original error.
            this.stack = `${new Error('').stack}\n\n${originalException.stack}`;
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public static from(message: string, err: any) {
        if (err instanceof BaseError) {
            return err;
        } else {
            return new WrappedError(message, err);
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public static unwrap(err: any) {
        if (!err) {
            return err;
        }
        // Unwrap the errors.
        if (err instanceof WrappedError && err.originalException && err.originalException instanceof BaseError) {
            err = err.originalException;
        }
        return err;
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
    | 'kernelpromisetimeout'
    | 'jupytersession'
    | 'jupyterconnection'
    | 'jupyterinstall'
    | 'jupyterselfcert'
    | 'jupyterpassword'
    | 'jupyterexpiredcert'
    | 'jupyterselfexpiredcert'
    | 'invalidkernel'
    | 'noipykernel'
    | 'fetcherror'
    | 'notinstalled'
    | 'kernelspecnotfound' // Left for historical purposes, not used anymore.
    | 'unsupportedKernelSpec' // Left for historical purposes, not used anymore.
    | 'sessionDisposed'
    | 'nodeonly'
    | 'remotejupyterserverconnection'
    | 'localjupyterserverconnection'
    | 'remotejupyterserveruriprovider'
    | 'invalidremotejupyterserverurihandle'
    | 'jupyternotebooknotinstalled'
    | 'jupytercannotbelaunchedwitheroot'
    | 'pythonExtension'
    | 'windowsLongPathNotEnabled'
    | 'unknown';

// If there are errors, then the are added to the telementry properties.
export type TelemetryErrorProperties = {
    /**
     * Whether there was a failure.
     * Common to most of the events.
     */
    failed: true;
    /**
     * Node stacktrace without PII.
     * Common to most of the events.
     */
    stackTrace?: string;
    /**
     * A reason that we generate (e.g. kerneldied, noipykernel, etc), more like a category of the error.
     * Common to most of the events.
     */
    failureCategory?: string;
    /**
     * Further sub classification of the error. E.g. kernel died due to the fact that zmq is not installed properly.
     * Common to most of the events.
     */
    failureSubCategory?: string;
    /**
     * Hash of the file name that contains the file in the last frame (from Python stack trace).
     * Common to most of the events.
     */
    pythonErrorFile?: string;
    /**
     * Hash of the folder that contains the file in the last frame (from Python stack trace).
     * Common to most of the events.
     */
    pythonErrorFolder?: string;
    /**
     * Hash of the module that contains the file in the last frame (from Python stack trace).
     * Common to most of the events.
     */
    pythonErrorPackage?: string;
};
