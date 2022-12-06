// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from 'fs-extra';
import { applyEdits, ModificationOptions, modify } from 'jsonc-parser';
import * as path from '../../platform/vscode-path/path';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../constants.node';

const settingsFile = path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src/test/datascience/.vscode/settings.json');

function updateSettings() {
    const modificationOptions: ModificationOptions = {
        formattingOptions: {
            tabSize: 4,
            insertSpaces: true
        }
    };
    let settingsJson = fs.readFileSync(settingsFile).toString();

    // We don't want auto save to interfere with the tests.
    // Some times we want notebooks to be dirty (if we want to save we can do that in tests).
    settingsJson = applyEdits(settingsJson, modify(settingsJson, ['files.autoSave'], 'off', modificationOptions));
    fs.writeFileSync(settingsFile, settingsJson);
}

updateSettings();
