// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

// Not sure why but on windows, if you execute a process from the System32 directory, it will just crash Node.
// Not throw an exception, just make node exit.
// However if a system32 process is run first, everything works.
import * as child_process from 'child_process';
import * as os from 'os';

import { setupCoverage } from './coverage';
if (os.platform() === 'win32') {
    const proc = child_process.spawn('C:\\Windows\\System32\\Reg.exe', ['/?']);
    proc.on('error', () => {
        // eslint-disable-next-line no-console
        console.error('error during reg.exe');
    });
}

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
if ((Reflect as any).metadata === undefined) {
    require('reflect-metadata');
}

process.env.VSC_JUPYTER_CI_TEST = '1';
process.env.VSC_JUPYTER_UNIT_TEST = '1';

import { initialize } from './vscode-mock';

// Rebuild with nyc
const nyc = setupCoverage();

exports.mochaHooks = {
    afterAll() {
        this.timeout(30000);
        // Also output the nyc coverage if we have any
        if (nyc) {
            nyc.writeCoverageFile();
            return nyc.report();
        }
    }
};

initialize();
