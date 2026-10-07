// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect } from 'chai';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from '../platform/vscode-path/path';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from './constants.node';

suite('Generated proposed API declarations', () => {
    setup(() => {
        execFileSync(process.execPath, [path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'api', 'proposed.js')], {
            cwd: EXTENSION_ROOT_DIR_FOR_TESTS
        });
    });

    test('exposes the Jupyter server kernel discovery API', () => {
        const api = fs.readFileSync(path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'api', 'api.d.ts'), 'utf8');
        const discoveryInterface = api.match(
            /export\s+interface\s+JupyterServerKernelDiscovery\s*\{(?<members>[^}]*)\}/
        );

        expect(discoveryInterface, 'JupyterServerKernelDiscovery declaration').to.not.be.null;
        expect(discoveryInterface?.groups?.members, 'JupyterServerKernelDiscovery members').to.match(
            /^\s*readonly\s+status\s*:\s*'discovering'\s*\|\s*'idle'\s*;\s*readonly\s+lastError\?\s*:\s*Error\s*;\s*readonly\s+onDidChangeStatus\s*:\s*Event\s*<\s*void\s*>\s*;\s*$/
        );
        expect(api).to.match(
            /startJupyterServerKernelDiscovery\s*\(\s*collectionId\s*:\s*string\s*,\s*serverId\s*:\s*string\s*\)\s*:\s*Promise\s*<\s*JupyterServerKernelDiscovery\s*>/
        );
        expect(api).to.not.match(/\bactivateJupyterServer\b/);
    });
});
