// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

// Not sure why but on windows, if you execute a process from the System32 directory, it will just crash Node.
// Not throw an exception, just make node exit.
// However if a system32 process is run first, everything works.
import * as child_process from 'child_process';
import * as os from 'os';
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

import { setupCoverage } from './coverage';

process.env.VSC_JUPYTER_CI_TEST = '1';
process.env.VSC_JUPYTER_UNIT_TEST = '1';
process.env.NODE_ENV = 'production'; // Make sure react is using production bits or we can run out of memory.

import { setUpDomEnvironment, setupTranspile } from './datascience/reactHelpers';
import { initialize } from './vscode-mock';

// Custom module loader so we skip .css files that break non webpack wrapped compiles
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const Module = require('module');

// Required for DS functional tests.
// eslint-disable-next-line
(function () {
    const origRequire = Module.prototype.require;
    const _require = (context: any, filepath: any) => {
        return origRequire.call(context, filepath);
    };
    Module.prototype.require = function (filepath: string) {
        if (filepath.endsWith('.css') || filepath.endsWith('.svg')) {
            return '';
        }
        if (filepath.startsWith('expose-loader?')) {
            // Pull out the thing to expose
            const queryEnd = filepath.indexOf('!');
            if (queryEnd >= 0) {
                const query = filepath.substring('expose-loader?'.length, queryEnd);
                // eslint-disable-next-line no-invalid-this
                (global as any)[query] = _require(this, filepath.substring(queryEnd + 1));
                return '';
            }
        }
        if (filepath.startsWith('slickgrid/slick.core')) {
            // Special case. This module sticks something into the global 'window' object.
            // eslint-disable-next-line no-invalid-this
            const result = _require(this, filepath);

            // However it doesn't look in the 'window' object later. we have to move it to
            // the globals when in node.js
            if ((window as any).Slick) {
                (global as any).Slick = (window as any).Slick;
            }

            return result;
        }
        // eslint-disable-next-line no-invalid-this
        return _require(this, filepath);
    };
})();

// Setting up DOM env and transpile is required for the react & monaco related tests.
// However this takes around 40s to setup on Mac, hence slowing down testing/development.
// Allowing ability to disable this (faster local development & testing, saving minutes).
if (process.argv.indexOf('--fast') === -1) {
    // nteract/transforms-full expects to run in the browser so we have to fake
    // parts of the browser here.
    setUpDomEnvironment();

    // Also have to setup babel to get the monaco editor to work.
    setupTranspile();
}

// Rebuild with nyc
const nyc = setupCoverage();

exports.mochaHooks = {
    afterAll() {
        let nycPromise: Promise<void> | undefined;

        // Output the nyc coverage if we have any
        if (nyc) {
            nyc.writeCoverageFile();
            nycPromise = nyc.report();
        }

        const kernelLauncherMod = require('../client/datascience/kernel-launcher/kernelLauncher');

        // After all tests run, clean up the kernel launcher mutex files
        return kernelLauncherMod.KernelLauncher.cleanupStartPort().then(() => nycPromise);
    }
};

initialize();
