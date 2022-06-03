// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { sharedIWDebuggerTests } from './interactiveDebugging.vscode.common';
import { startJupyterServer } from './notebook/helper.web';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('Interactive Window Debugging', function () {
    sharedIWDebuggerTests.bind(this)({ startJupyterServer });
});
