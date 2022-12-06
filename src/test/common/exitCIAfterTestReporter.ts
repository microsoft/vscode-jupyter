// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

// Custom reporter to ensure Mocha process exits when we're done with tests.
// This is a hack, however for some reason the process running the tests do not exit.
// The hack is to force it to die when tests are done, if this doesn't work we've got a bigger problem on our hands.

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any, no-console, @typescript-eslint/no-extraneous-class, import/no-default-export */
import * as fs from 'fs-extra';
import * as net from 'net';
import * as path from '../../platform/vscode-path/path';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../constants.node';
import { noop } from '../core';

let client: net.Socket | undefined;
const mochaTests: any = require('mocha');
const { EVENT_RUN_BEGIN, EVENT_RUN_END } = mochaTests.Runner.constants;

async function connectToServer() {
    const portFile = path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'port.txt');
    if (!(await fs.pathExists(portFile))) {
        return;
    }
    const port = parseInt(await fs.readFile(portFile, 'utf-8'), 10);
    console.log(`Need to connect to port ${port}`);
    return new Promise((resolve) => {
        try {
            client = new net.Socket();
            client.connect({ port }, () => {
                console.log(`Connected to port ${port}`);
                resolve(client);
            });
            client.on('error', (err) => {
                console.log(`Errors connecting to port ${port}: ${err}`);
                // Swallow errors, else node will complain.
            });
        } catch {
            console.error('Failed to connect to socket server to notify completion of tests');
            resolve(client);
        }
    });
}
function notifyCompleted(hasFailures: boolean) {
    if (!client || client.destroyed || !client.writable) {
        console.error(`No client to write from ${client}.`);
        return;
    }
    try {
        const exitCode = hasFailures ? 1 : 0;
        console.log(`Notify server of test completion with code ${exitCode}`);
        // If there are failures, send a code of 1 else 0.
        client.write(exitCode.toString());
        client.end();
        console.log('Notified server of test completion');
    } catch (ex) {
        console.error('Socket client error', ex);
    }
}

class ExitReporter {
    constructor(runner: any) {
        console.log('Initialize Exit Reporter for Mocha (PVSC).');
        connectToServer().catch(noop);
        const stats = runner.stats;
        runner
            .once(EVENT_RUN_BEGIN, () => {
                console.info('Start Exit Reporter for Mocha.');
            })
            .once(EVENT_RUN_END, async () => {
                notifyCompleted(stats.failures > 0);
                console.info('End Exit Reporter for Mocha.');
            });
    }
}

module.exports = ExitReporter;
