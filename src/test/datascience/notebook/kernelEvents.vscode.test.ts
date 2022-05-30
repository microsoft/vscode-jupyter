// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { startJupyterServer } from './helper.node';
import { sharedKernelEventTests } from './kernelEvents.vscode.common';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('Kernel Events', function () {
    sharedKernelEventTests.bind(this)({ startJupyterServer });
});
