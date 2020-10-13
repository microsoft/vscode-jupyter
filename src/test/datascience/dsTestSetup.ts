// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as fs from 'fs-extra';
import { applyEdits, ModificationOptions, modify } from 'jsonc-parser';
import * as path from 'path';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../constants';

const settingsFile = path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src/test/datascience/.vscode/settings.json');

function updateTestsForNativeNotebooks() {
    /**
     * Modify package.json to ensure VSC Notebooks have been setup so tests can run.
     * This is required because we modify package.json during runtime, hence we need to do the same thing for tests.
     */
    const packageJsonFile = path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'package.json');
    const content = JSON.parse(fs.readFileSync(packageJsonFile).toString());

    // This code is temporary.
    content.enableProposedApi = true;
    delete content.contributes.notebookProvider[0].priority;

    // Update package.json to pick experiments from our custom settings.json file.
    content.contributes.configuration.properties['jupyter.experiments.optInto'].scope = 'resource';
    content.contributes.configuration.properties['jupyter.logging.level'].scope = 'resource';

    fs.writeFileSync(packageJsonFile, JSON.stringify(content, undefined, 4));
    updateSettings(true);
}

function updateSettings(useNativeNotebooks: boolean) {
    const modificationOptions: ModificationOptions = {
        formattingOptions: {
            tabSize: 4,
            insertSpaces: true
        }
    };
    let settingsJson = fs.readFileSync(settingsFile).toString();
    const experiments = useNativeNotebooks ? ['NativeNotebookEditor'] : [];
    const autoSave = useNativeNotebooks ? 'off' : 'afterDelay';

    settingsJson = applyEdits(
        settingsJson,
        modify(settingsJson, ['jupyter.experiments.optInto'], experiments, modificationOptions)
    );
    settingsJson = applyEdits(settingsJson, modify(settingsJson, ['files.autoSave'], autoSave, modificationOptions));

    fs.writeFileSync(settingsFile, settingsJson);
}
function updateTestsForOldNotebooks() {
    updateSettings(false);
}
// tslint:disable: no-console
console.error(`VSC_JUPYTER_CI_RUN_NON_PYTHON_NB_TEST = ${process.env.VSC_JUPYTER_CI_RUN_NON_PYTHON_NB_TEST}`);
console.error(`VSC_JUPYTER_CI_TEST_VSC_CHANNEL = ${process.env.VSC_JUPYTER_CI_TEST_VSC_CHANNEL}`);
console.error(`VSC_JUPYTER_RUN_NB_TEST = ${process.env.VSC_JUPYTER_RUN_NB_TEST}`);

// When in insiders, always run the Notebook tests.
if (process.env.VSC_JUPYTER_CI_TEST_VSC_CHANNEL === 'insiders' && process.env.VSC_JUPYTER_RUN_NB_TEST) {
    updateTestsForNativeNotebooks();
} else {
    updateTestsForOldNotebooks();
}
