// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

export enum KernelFailureReason {
    /**
     * Creating files such as os.py and having this in the root directory or some place where Python would load it,
     * would result in the `os` module being overwritten with the users `os.py` file.
     * Novice python users tend to do this very often, and this causes the python runtime to crash.
     *
     * We identify this based on the error message dumped in the stderr stream.
     */
    overridingBuiltinModules = 'overridingBuiltinModules'
}
