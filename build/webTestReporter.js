// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const fs = require('fs-extra');
const path = require('path');
const { createServer } = require('http');
const jsonc = require('jsonc-parser');
const mocha = require('mocha');
const colors = require('colors');
const { EventEmitter } = require('events');
const { sleep } = require('../out/test/core');

const settingsFile = path.join(__dirname, '..', 'src', 'test', 'datascience', '.vscode', 'settings.json');
const webTestSummaryJsonFile = path.join(__dirname, '..', 'webtest.json');
const webTestSummaryFile = path.join(__dirname, '..', 'webtest.txt');
const progress = [];
exports.startReportServer = async function () {
    return new Promise((resolve) => {
        console.log(`Creating test server`);
        server = createServer((req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST,GET');
            res.setHeader('Access-Control-Max-Age', 2592000); // 30 days

            if (req.method === 'OPTIONS') {
                res.writeHead(200, {
                    'Access-Control-Allow-Origin': '*', // REQUIRED CORS HEADER
                    'Access-Control-Allow-Methods': 'GET, POST, DELETE, PUT, PATCH', // REQUIRED CORS HEADER
                    'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept' // REQUIRED CORS HEADER
                });
                res.end();
                return;
            } else if (req.method === 'GET') {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('Done');
            } else if (req.method === 'POST') {
                let data = '';
                req.on('data', (chunk) => {
                    data += chunk.toString();
                });
                req.on('end', () => {
                    fs.appendFileSync(webTestSummaryFile, data);
                    try {
                        progress.push(JSON.parse(data));
                    } catch (ex) {
                        console.error('Failed to parse test output', ex);
                    }
                    res.writeHead(200);
                    res.end();
                });
            } else {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('Done');
            }
        });
        server.listen({ host: '127.0.0.1', port: 0 }, async () => {
            const port = server.address().port;
            console.log(`Test server listening on port ${port}`);
            const settingsJson = fs.readFileSync(settingsFile).toString();
            const edits = jsonc.modify(settingsJson, ['jupyter.REPORT_SERVER_PORT'], port, {});
            const updatedSettingsJson = jsonc.applyEdits(settingsJson, edits);
            fs.writeFileSync(settingsFile, updatedSettingsJson);
            console.log(`Test server listening on port and settings file ${updatedSettingsJson} updated`);
            resolve({
                dispose: async () => {
                    console.error(`Disposing test server`);
                    fs.writeFileSync(webTestSummaryJsonFile, JSON.stringify(progress));
                    server.close();
                }
            });
        });
    });
};

// const messageHandlers = new Map();
// messageHandlers.set(mocha.Runner.constants.EVENT_RUN_BEGIN, startTests);
// messageHandlers.set(mocha.Runner.constants.EVENT_RUN_END, endTests);
// messageHandlers.set(mocha.Runner.constants.EVENT_SUITE_BEGIN, beginSuite);
// messageHandlers.set(mocha.Runner.constants.EVENT_SUITE_END, endSuite);
// messageHandlers.set(mocha.Runner.constants.EVENT_TEST_FAIL, testFailed);
// messageHandlers.set(mocha.Runner.constants.EVENT_TEST_PENDING, testSkipped);
// messageHandlers.set(mocha.Runner.constants.EVENT_TEST_PASS, testPassed);

// function startTests() {
//     //
// }
// /**
//  * @param {{stats: mocha.Stats}} output
//  */
// function endTests(output) {
//     const messages = [];
//     if (output.stats) {
//         if (output.stats.pending) {
//             messages.push(`${colors.yellow(`${output.stats.pending} Pending`)}`);
//         }
//         if (output.stats.passes) {
//             messages.push(`${colors.green(`${output.stats.pending} Passed`)}`);
//         }
//         if (output.stats.failures) {
//             messages.push(`${colors.red(`${output.stats.failures} Failed`)}`);
//         }
//         if (output.stats.duration) {
//             messages.push(`in ${output.stats.duration / 1000}s`);
//         }
//     }
//     console.log(`${output.stats.tests} tests in ${output.stats.suites} suites, completed, with ${messages.join(', ')}`);
// }
// let indentation = 0;
// function getIndentation() {
//     return '  '.repeat(indentation);
// }
// /**
//  * @param {{title: string}} output
//  */
// function beginSuite(output) {
//     if (output.title) {
//         console.log(`${getIndentation()}${output.title}:`);
//         indentation += 1;
//     }
// }
// function endSuite() {
//     indentation -= 1;
// }
// /**
//  * @typedef {Object} Exception
//  * @property {string} message
//  * @property {string} stack
//  * @property {string} name
//  * @property {string} generatedMessage
//  * @property {string} actual
//  * @property {string} expected
//  * @property {string} operator
//  */
// /**
//  * @param {{ title:string; duration?:number; err?:Exception; }} output
//  */
// function testFailed(output) {
//     const durationSuffix = typeof output.duration === 'number' ? ` after ${output.duration / 1000}s` : '';
//     let errorMessage = output.err.stack;
//     if ((output.err.name || '').includes('Assertion')) {
//         errorMessage = `${output.err.name}: ${output.err.message}`;
//     }
//     console.log(
//         [
//             `${colors.red('✕ Failed')}: ${output.title}${durationSuffix}`,
//             `${getIndentation()}${getIndentation()}${errorMessage}`
//         ]
//             .map((line) => `${getIndentation()}${line}`)
//             .join('\n')
//     );
// }
// /**
//  * @param {{ title:string;  }} output
//  */
// function testSkipped(output) {
//     console.log(`${getIndentation()}${getIndentation()}${colors.yellow('Skipped')}: ${output.title}`);
// }
// /**
//  * @param {{ title:string; duration:number  }} output
//  */
// function testPassed(output) {
//     const durationSuffix = typeof output.duration === 'number' ? ` in ${output.duration / 1000}s` : '';
//     console.log(`${getIndentation()}${colors.green('✓ Passed')}: ${output.title}${durationSuffix}`);
// }

exports.dumpTestSummary = () => {
    try {
        const summary = JSON.parse(fs.readFileSync(webTestSummaryJsonFile).toString());
        const eventEmitter = new EventEmitter();
        const reportWriter = new mocha.reporters.Spec(eventEmitter);
        reportWriter.failures = [];
        summary.forEach((output) => {
            // mocha expects test objects to have a method `slow, fullTitle, titlePath`.
            ['slow', 'fullTitle', 'titlePath'].forEach((fnName) => {
                const value = output[fnName];
                output[fnName] = () => value;
            });
            if ('stats' in output) {
                reportWriter.stats = output.stats;
            }
            if (output.event === 'fail') {
                reportWriter.failures.push(output);
            }
            eventEmitter.emit(output.event, Object.assign({}, output));
        });
    } catch (ex) {
        console.error('Failed dumpTestSummary', ex);
    }
};
