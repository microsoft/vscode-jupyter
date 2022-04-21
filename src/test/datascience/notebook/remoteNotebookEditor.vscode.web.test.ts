// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { commands, Uri } from 'vscode';
import { JUPYTER_SERVER_URI } from '../../constants';
import { sharedRemoteNotebookEditorTests } from './remoteNotebookEditor.vscode.common';

suite('DataScience - VSCode Notebook - (Remote) (Execution) (slow)', function () {
    // Use the shared code that runs the tests
    sharedRemoteNotebookEditorTests(this, async (n) => {
        // Server URI should have been embedded in the constants file
        const uri = Uri.parse(JUPYTER_SERVER_URI);
        console.log(`ServerURI for remote test: ${JUPYTER_SERVER_URI}`);
        // Use this URI to set our jupyter server URI
        return commands.executeCommand('jupyter.selectjupyteruri', false, uri, n);
    });
});
