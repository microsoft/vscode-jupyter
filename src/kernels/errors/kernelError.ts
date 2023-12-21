// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { IErrorMsg, IReplyErrorContent } from '@jupyterlab/services/lib/kernel/messages';

export class KernelError extends Error {
    public readonly ename: string;
    public readonly evalue: string;
    public readonly traceback: string[];
    constructor(kernelError: IReplyErrorContent | IErrorMsg['content']) {
        super(kernelError.evalue || kernelError.ename);
        this.ename = kernelError.ename;
        this.evalue = kernelError.evalue;
        this.traceback = kernelError.traceback;
    }
}
