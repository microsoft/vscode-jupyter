// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any,  */

import { expect } from 'chai';
import * as fs from 'fs';
import glob from 'glob';
import * as path from '../platform/vscode-path/path';
import { EXTENSION_ROOT_DIR } from '../platform/constants.node';

suite('Extension localization files', () => {
    test('Load localization file', () => {
        const filesFailed: string[] = [];
        glob.sync('package.nls.*.json', { sync: true, cwd: EXTENSION_ROOT_DIR }).forEach((localizationFile) => {
            try {
                JSON.parse(fs.readFileSync(path.join(EXTENSION_ROOT_DIR, localizationFile)).toString());
            } catch {
                filesFailed.push(localizationFile);
            }
        });

        expect(filesFailed).to.be.lengthOf(0, `Failed to load JSON for ${filesFailed.join(', ')}`);
    });
});
