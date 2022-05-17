// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { startJupyterServer } from './helper.web';
import { sharedIPyWidgetStandardTests } from './ipywidget.vscode.common';

suite('DataScience - VSCode Notebook - Standard IPyWidgets web', function () {
    // Use the shared code that runs the tests
    sharedIPyWidgetStandardTests(this, (n) => {
        return startJupyterServer(n);
    });
});
