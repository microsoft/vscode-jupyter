// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

// reflect-metadata is needed by inversify, this must come before any inversify references
import '../platform/ioc/reflectMetadata';

// Not sure why but on windows, if you execute a process from the System32 directory, it will just crash Node.
// Not throw an exception, just make node exit.
// However if a system32 process is run first, everything works.
import * as child_process from 'child_process';
import * as os from 'os';
import { setTestExecution, setUnitTestExecution } from '../platform/common/constants';
import { setupCoverage } from './coverage.node';
if (os.platform() === 'win32') {
    const proc = child_process.spawn('C:\\Windows\\System32\\Reg.exe', ['/?']);
    proc.on('error', () => {
        // eslint-disable-next-line no-console
        console.error('error during reg.exe');
    });
}

setTestExecution(true);
setUnitTestExecution(true);

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
