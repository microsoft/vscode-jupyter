// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { IExtensionTestApi } from '../common.node';
import { startJupyterServer } from './notebook/helper.web';
import { sharedInterActiveWindowTests } from './interactiveWindow.vscode.common';

suite(`Interactive window tests on web`, async function () {
    sharedInterActiveWindowTests(
        this,
        undefined,
        (n) => {
            return startJupyterServer(n);
        },
        async (_: IExtensionTestApi) => {
            // nothing extra to set up in web
        }
    );
});
