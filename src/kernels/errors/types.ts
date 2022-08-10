// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    KernelAction,
    KernelActionSource,
    KernelConnectionMetadata,
    KernelInterpreterDependencyResponse
} from '../../kernels/types';
import { Resource } from '../../platform/common/types';
import { BaseError, ErrorCategory, WrappedError } from '../../platform/errors/types';

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
    getErrorMessageForDisplayInCell(err: Error, errorContext: KernelAction, resource: Resource): Promise<string>;
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

export class WrappedKernelError extends WrappedError {
    constructor(
        message: string,
        originalException: Error | undefined,
        public readonly kernelConnectionMetadata: KernelConnectionMetadata
    ) {
        super(message, originalException);
    }
}
