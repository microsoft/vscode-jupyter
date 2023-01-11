// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable no-console */

// Note: all functional tests that trigger the VS Code "fs" API are
// found in filesystem.test.ts.

export class SystemError extends Error {
    public code: string;
    public errno: number;
    public syscall: string;
    public info?: string;
    public path?: string;
    public address?: string;
    public dest?: string;
    public port?: string;
    constructor(code: string, syscall: string, message: string) {
        super(`${code}: ${message} ${syscall} '...'`);
        this.code = code;
        this.errno = 0; // Don't bother until we actually need it.
        this.syscall = syscall;
    }
}
