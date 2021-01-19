// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { ChildProcess, spawn, SpawnOptions } from 'child_process';
import * as fs from 'fs-extra';
import { AddressInfo, createServer, Server } from 'net';
import * as path from 'path';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from './constants';
import { noop, sleep } from './core';
import { initializeLogger } from './testLogger';

initializeLogger();

/* eslint-disable no-console */

/*
This is a simple work around for tests tasks not completing on CI.
What's been happening is, the tests run however for some reason the Node process (VS Code) does not exit.
Here's what we've tried thus far:
* Dispose all timers
* Close all open streams/sockets.
* Use `process.exit` and use the VSC commands to close itself.

Final solution:
* Start a node.js process
    * This process will start a socket server
    * This process will start the tests in a separate process (spawn)
* When the tests have completed,
    * Send a message to the socket server with a flag (true/false whether tests passed/failed)
* Socket server (main process) will receive the test status flag.
    * This will kill the spawned process
    * This main process will kill itself with exit code 0 if tests pass successfully, else 1.

Usage:
* Original code `node xyz.js`
* Updated code `node testBootstrap.js xyz.js`
*/

const testFile = process.argv[2];
const portFile = path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'port.txt');

let proc: ChildProcess | undefined;
let server: Server | undefined;

async function deletePortFile() {
    try {
        if (await fs.pathExists(portFile)) {
            await fs.unlink(portFile);
        }
    } catch {
        noop();
    }
}
async function end(exitCode: number) {
    if (exitCode === 0) {
        console.log('Exiting without errors');
    } else {
        console.error('Exiting with test failures');
    }
    if (proc) {
        try {
            const procToKill = proc;
            proc = undefined;
            console.log('Killing VSC');
            await deletePortFile();
            // Wait for the std buffers to get flushed before killing.
            await sleep(5_000);
            procToKill.kill();
        } catch {
            noop();
        }
    }
    if (server) {
        server.close();
    }
    // Exit with required code.
    process.exit(exitCode);
}

async function startSocketServer() {
    return new Promise((resolve) => {
        console.log(`Creating test server`);
        server = createServer((socket) => {
            socket.on('data', (buffer) => {
                const data = buffer.toString('utf8');
                console.log(`Exit code from Tests is ${data}`);
                const code = parseInt(data.substring(0, 1), 10);
                end(code).catch(noop);
            });
            socket.on('error', (ex) => {
                // Just log it, no need to do anything else.
                console.error(ex);
            });
        });
        server.on('error', (ex) => {
            // Just log it, no need to do anything else.
            console.error(ex);
        });
        console.log(`Listening to test server`);
        server.listen({ host: '127.0.0.1', port: 0 }, async () => {
            const port = (server!.address() as AddressInfo).port;
            console.log(`Test server listening on port ${port}`);
            await deletePortFile();
            await fs.writeFile(portFile, port.toString());
            resolve();
        });
        console.log(`Test server running`);
    });
}

async function start() {
    console.log('Starting socket server for tests.');
    await startSocketServer();
    const options: SpawnOptions = { cwd: process.cwd(), env: process.env, detached: true, stdio: 'inherit' };
    proc = spawn(process.execPath, [testFile], options);
    proc.once('close', end);
}

start().catch((ex) => {
    console.error('File testBootstrap.ts failed with Errors', ex);
    process.exit(1);
});
