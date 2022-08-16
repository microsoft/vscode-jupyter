// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const fs = require('fs-extra');
const path = require('path');
const { createServer } = require('http');
const jsonc = require('jsonc-parser');
const mocha = require('mocha');
const dedent = require('dedent');
const { EventEmitter } = require('events');
const colors = require('colors');
const core = require('@actions/core');
const hashjs = require('hash.js');
const glob = require('glob');
const { ExtensionRootDir } = require('./constants');

const settingsFile = path.join(__dirname, '..', 'src', 'test', 'datascience', '.vscode', 'settings.json');
const webTestSummaryJsonFile = path.join(__dirname, '..', 'testresults.json');
const webTestSummaryNb = path.join(__dirname, '..', 'testresults.ipynb');
const progress = [];

async function captureScreenShot(name, res) {
    try {
        const screenshot = require('screenshot-desktop');
        const filename = path.join(ExtensionRootDir, name);
        await screenshot({ filename });
        console.info(`Screenshot captured into ${filename}`);
    } catch (ex) {
        console.error(`Failed to capture screenshot into ${filename}`, ex);
    }
    res.writeHead(200);
    res.end();
}
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
                    try {
                        const jsonData = jsonc.parse(data);
                        if ('command' in jsonData && jsonData.command === 'captureScreenShot') {
                            return captureScreenShot(jsonData.filename, res);
                        } else {
                            progress.push(jsonData);
                        }
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

exports.dumpTestSummary = () => {
    try {
        const summary = JSON.parse(fs.readFileSync(webTestSummaryJsonFile).toString());
        const runner = new EventEmitter();
        runner.stats = {};
        const reportWriter = new mocha.reporters.Spec(runner, { color: true });
        reportWriter.failures = [];
        const cells = [];
        let indent = 0;
        let executionCount = 0;
        const skippedTests = [];
        let passedCount = 0;
        mocha.reporters.Base.useColors = true;
        colors.enable();
        summary.forEach((output) => {
            output = JSON.parse(JSON.stringify(output));
            // mocha expects test objects to have a method `slow, fullTitle, titlePath`.
            ['slow', 'fullTitle', 'titlePath', 'isPending', 'currentRetry'].forEach((fnName) => {
                const value = output[fnName];
                output[fnName] = () => value;
            });
            // Tests have a parent with a title, used by xunit.
            const currentParent = output.parent || { fullTitle: '' };
            output.parent = {
                fullTitle: () => ('fullTitle' in currentParent ? currentParent.fullTitle : '') || ''
            };
            if ('stats' in output) {
                reportWriter.stats = { ...output.stats };
                Object.assign(runner.stats, output.stats);
            }
            if (output.event === 'fail') {
                reportWriter.failures.push(output);
            }
            runner.emit(output.event, output, output.err);

            switch (output.event) {
                case 'pass': {
                    passedCount++;
                    break;
                }
                case 'suite': {
                    indent += 1;
                    const indentString = '#'.repeat(indent);
                    cells.push({
                        cell_type: 'markdown',
                        metadata: {
                            collapsed: true
                        },
                        source: dedent`
                                ${indentString} ${output.title}
                                `
                    });
                    break;
                }
                case 'suite end': {
                    indent -= 1;
                    break;
                }
                case 'pending': {
                    skippedTests.push(output);
                    break;
                }
                case 'fail': {
                    const stackFrames = (output.err.stack || '').split(/\r?\n/);
                    const line1 = stackFrames.shift() || '';
                    const fullTestNameHash = hashjs
                        .sha256()
                        .update(output.fullTitle() || '')
                        .digest('hex')
                        .substring(0, 10);
                    const fileNamePrefix = `${output.title}_${fullTestNameHash}`.replace(/[\W]+/g, '_');
                    const assertionError = {
                        ename: '',
                        evalue: '',
                        output_type: 'error',
                        traceback: [`${colors.red(line1)}\n`, stackFrames.join('\n')]
                    };
                    const consoleOutputs = (output.consoleOutput || [])
                        .map((item) => {
                            const time = item.time ? new Date(item.time) : '';
                            const timeStr = time ? `${time.toLocaleTimeString()}.${time.getMilliseconds()}` : '';
                            const colorizedTime = timeStr ? `${colors.blue(timeStr)}: ` : '';
                            switch (item.category) {
                                case 'warn':
                                    return `${colorizedTime}${colors.yellow(item.output)}`;
                                case 'error':
                                    return `${colorizedTime}${colors.red(item.output)}`;
                                default:
                                    return `${colorizedTime}${item.output}`;
                                    break;
                            }
                        })
                        .map((item) => `${item}\n`);
                    const consoleOutput = {
                        name: 'stdout',
                        output_type: 'stream',
                        text: consoleOutputs
                    };
                    // Look for a screenshot file with the above prefix & attach that to the cell outputs.
                    console.error(`Looking for screenshot file ${fileNamePrefix}*-screenshot.png`);
                    const screenshots = glob
                        .sync(`${fileNamePrefix}*-screenshot.png`, { cwd: ExtensionRootDir })
                        .map((file) => {
                            console.error(`Found screenshot file ${file}`);
                            const contents = Buffer.from(fs.readFileSync(path.join(ExtensionRootDir, file))).toString(
                                'base64'
                            );
                            return {
                                data: {
                                    'image/png': contents
                                },
                                metadata: {},
                                output_type: 'display_data'
                            };
                        });
                    cells.push({
                        cell_type: 'code',
                        metadata: {
                            collapsed: true
                        },
                        source: `#${output.title}`,
                        execution_count: ++executionCount,
                        outputs: [assertionError, consoleOutput, ...screenshots]
                    });
                    break;
                }
            }
        });

        if (reportWriter.failures.length) {
            core.setFailed(`${reportWriter.failures.length} tests failed.`);
        } else if (passedCount < 3) {
            // the non-python suite only has 4 tests passing currently, so that's the highest bar we can use.
            core.setFailed('Not enough tests were run - are too many being skipped?');
        }

        // Write output into an ipynb file with the failures & corresponding console output & screenshot.
        if (cells.length) {
            fs.writeFileSync(webTestSummaryNb, JSON.stringify({ cells: cells }));
        }
    } catch (ex) {
        core.error('Failed to print test summary');
        core.setFailed(ex);
    }
};
