// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import {
    KernelAction,
    KernelActionSource,
    KernelConnectionMetadata,
    KernelInterpreterDependencyResponse
} from '../../kernels/types';
import { Resource } from '../common/types';

export abstract class BaseError extends Error {
    public stdErr?: string;
    constructor(public readonly category: ErrorCategory, message: string) {
        super(message);
    }
}

export abstract class BaseKernelError extends BaseError {
    public override stdErr?: string;
    constructor(
        category: ErrorCategory,
        message: string,
        public readonly kernelConnectionMetadata: KernelConnectionMetadata
    ) {
        super(category, message);
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
export class WrappedKernelError extends WrappedError {
    constructor(
        message: string,
        originalException: Error | undefined,
        public readonly kernelConnectionMetadata: KernelConnectionMetadata
    ) {
        super(message, originalException);
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

export const IDataScienceErrorHandler = Symbol('IDataScienceErrorHandler');
export interface IDataScienceErrorHandler {
    /**
     * Handles the errors and if necessary displays an error message.
     */
    handleError(err: Error): Promise<void>;
    /**
     * Handles errors specific to kernels.
     * The value of `errorContext` is used to determine the context of the error message, whether it applies to starting or interrupting kernels or the like.
     * Thus based on the context the error message would be different.
     */
    handleKernelError(
        err: Error,
        errorContext: KernelAction,
        kernelConnection: KernelConnectionMetadata,
        resource: Resource,
        actionSource: KernelActionSource
    ): Promise<KernelInterpreterDependencyResponse>;
    /**
     * The value of `errorContext` is used to determine the context of the error message, whether it applies to starting or interrupting kernels or the like.
     * Thus based on the context the error message would be different.
     */
    getErrorMessageForDisplayInCell(err: Error, errorContext: KernelAction): Promise<string>;
}
