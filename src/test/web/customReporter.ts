/* eslint-disable @typescript-eslint/no-explicit-any */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import type * as mochaTypes from 'mocha';
import { env, extensions, UIKind, Uri, workspace } from 'vscode';
import { JVSC_EXTENSION_ID_FOR_TESTS } from '../constants';
import { noop } from '../core';
import { format } from 'util';
import { registerLogger } from '../../platform/logging/index';
import { Arguments, ILogger } from '../../platform/logging/types';
const { inherits } = require('mocha/lib/utils');
const defaultReporter = require('mocha/lib/reporters/spec');

const constants = {
    EVENT_RUN_BEGIN: 'start',
    EVENT_RUN_END: 'end',
    EVENT_SUITE_BEGIN: 'suite',
    EVENT_SUITE_END: 'suite end',
    EVENT_TEST_BEGIN: 'test',
    EVENT_TEST_FAIL: 'fail',
    EVENT_TEST_PENDING: 'pending',
    EVENT_TEST_PASS: 'pass',
    EVENT_TEST_END: 'test end'
};
type Exception = {
    showDiff?: boolean;
    message: string;
    stack: string;
    name: string;
    generatedMessage: any;
    actual: any;
    expected: any;
    operator: any;
};
type ParentTest = { fullTitle?: string };

type Message =
    | { event: typeof constants.EVENT_RUN_BEGIN }
    | { event: typeof constants.EVENT_RUN_END; stats?: mochaTypes.Stats }
    | {
          event: typeof constants.EVENT_SUITE_BEGIN;
          title: string;
          titlePath: string[];
          fullTitle: string;
      }
    | {
          event: typeof constants.EVENT_SUITE_END;
          title: string;
          slow: number;
          titlePath: string[];
          fullTitle: string;
      }
    | {
          event: typeof constants.EVENT_TEST_FAIL;
          title: string;
          err: Exception;
          titlePath: string[];
          fullTitle: string;
          slow: number;
          parent?: ParentTest;
          isPending: boolean;
          duration?: number;
          state: 'failed' | 'passed' | undefined;
          consoleOutput: { category?: 'warn' | 'error'; output: string; time: number }[];
      }
    | {
          event: typeof constants.EVENT_TEST_PENDING;
          title: string;
          titlePath: string[];
          fullTitle: string;
          slow: number;
          isPending: boolean;
          duration?: number;
          state: 'failed' | 'passed' | undefined;
          parent?: ParentTest;
      }
    | {
          event: typeof constants.EVENT_TEST_PASS;
          title: string;
          titlePath: string[];
          fullTitle: string;
          slow: number;
          isPending: boolean;
          duration?: number;
          state: 'failed' | 'passed' | undefined;
          parent?: ParentTest;
      };
let currentPromise = Promise.resolve();
const messages: Message[] = [];
let url = '';

function writeReportProgress(message: Message) {
    if (env.uiKind === UIKind.Desktop) {
        messages.push(message);
        if (message.event === constants.EVENT_RUN_END) {
            const ext = extensions.getExtension(JVSC_EXTENSION_ID_FOR_TESTS)!.extensionUri;
            const logFile = Uri.joinPath(ext, 'testresults.json');
            workspace.fs.writeFile(logFile, Buffer.from(JSON.stringify(messages))).then(noop, noop);
        }
    } else {
        if (message.event === constants.EVENT_RUN_BEGIN) {
            console.log(
                `DEBUG_JUPYTER_SERVER_URI={workspace.getConfiguration('jupyter').get('DEBUG_JUPYTER_SERVER_URI')}`
            );
            const reportServerPor = workspace.getConfiguration('jupyter').get('REPORT_SERVER_PORT') as number;

            url = `http://127.0.0.1:${reportServerPor}`;
            console.error(`Started test reporter and writing to ${url}`);
        }
        currentPromise = currentPromise.finally(() => {
            return fetch(url, {
                method: 'post',
                body: JSON.stringify(message),
                headers: {
                    'Content-Type': 'application/json'
                }
            }).catch((_ex) => {
                // console.error(`Failed to post data to ${url}`, ex);
            });
        });
    }
}
function formatException(err: any) {
    const props = ['actual', 'expected', 'operator', 'generatedMessage'];
    let message = '';
    if (typeof err.inspect === 'function') {
        message = err.inspect() + '';
    } else if (err.message && typeof err.message.toString === 'function') {
        message = err.message + '';
    }
    const error: Record<string, any> = {
        name: err.name,
        message,
        stack: err.stack,
        showDiff: err.showDiff,
        inspect: ''
    };
    props.forEach((prop) => {
        try {
            error[prop] = JSON.parse(JSON.stringify(err[prop]));
        } catch {
            error[prop] = '<..?..>';
        }
    });
    return error as Exception;
}

/**
 * We use this to hijack all of the console output, so we have all of the output generated when a test fails.
 * This way we can see the logs and determine what caused a failure in a particular test (instead of having to look at a large log file)
 */
class ConsoleHijacker implements ILogger {
    private captureLogs?: boolean;
    private _outputs: { category?: 'warn' | 'error'; output: string; time: number }[] = [];
    public get output(): { category?: 'warn' | 'error'; output: string; time: number }[] {
        return this._outputs;
    }

    public hijack() {
        this.captureLogs = true;
        this._outputs = [];
    }
    public release() {
        const capturedOutput = this._outputs;
        this.captureLogs = false;
        this._outputs = [];
        return capturedOutput;
    }
    traceLog(message: string, ...data: Arguments): void {
        this.logMessage(undefined, message, data);
    }
    traceError(message: string, ...data: Arguments): void {
        this.logMessage('error', message, data);
    }
    traceWarn(message: string, ...data: Arguments): void {
        this.logMessage('warn', message, data);
    }
    traceInfo(message: string, ...data: Arguments): void {
        this.logMessage(undefined, message, data);
    }
    traceEverything(message: string, ...data: Arguments): void {
        this.logMessage(undefined, message, data);
    }
    traceVerbose(message: string, ...data: Arguments): void {
        this.logMessage(undefined, message, data);
    }
    logMessage(category: 'error' | 'warn' | undefined, message: string, ...data: Arguments) {
        if (!this.captureLogs) {
            return;
        }
        const output = ([message] as any[])
            .concat(data)
            .map((arg) => {
                try {
                    return format(arg);
                } catch {
                    return `${arg}`;
                }
            })
            .join(' ');
        this._outputs.push({ category, output, time: Date.now() });
    }
}

const consoleHijacker = new ConsoleHijacker();

registerLogger(consoleHijacker);
function CustomReporter(this: any, runner: mochaTypes.Runner, options: mochaTypes.MochaOptions) {
    defaultReporter.call(this, runner, options);
    console.error(`Created custom reporter`);
    const myFn = function () {
        console.error('hello');
    };
    console.log = myFn;
    console.log('Hello');
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    runner
        .once(constants.EVENT_RUN_BEGIN, () => {
            consoleHijacker.release();
            console.error(`Started tests`);
            writeReportProgress({ event: constants.EVENT_RUN_BEGIN });
        })
        .once(constants.EVENT_RUN_END, () => {
            consoleHijacker.release();
            console.error('Writing the end of the test run');
            writeReportProgress({ event: constants.EVENT_RUN_END, stats: runner.stats });
        })
        .on(constants.EVENT_SUITE_BEGIN, (suite: mochaTypes.Suite) => {
            consoleHijacker.release();
            writeReportProgress({
                event: constants.EVENT_SUITE_BEGIN,
                title: suite.title,
                titlePath: suite.titlePath(),
                fullTitle: suite.fullTitle()
            });
        })
        .on(constants.EVENT_SUITE_END, (suite: mochaTypes.Suite) => {
            consoleHijacker.release();
            writeReportProgress({
                event: constants.EVENT_SUITE_END,
                title: suite.title,
                titlePath: suite.titlePath(),
                slow: suite.slow(),
                fullTitle: suite.fullTitle()
            });
        })
        .on(constants.EVENT_TEST_FAIL, (test: mochaTypes.Test, err: any) => {
            const consoleOutput = consoleHijacker.release();
            writeReportProgress({
                event: constants.EVENT_TEST_FAIL,
                title: test.title,
                err: formatException(err),
                titlePath: test.titlePath(),
                slow: test.slow(),
                fullTitle: test.fullTitle(),
                consoleOutput,
                duration: test.duration,
                state: test.state,
                isPending: test.isPending(),
                parent: { fullTitle: test.parent?.fullTitle() }
            });
        })
        .on(constants.EVENT_TEST_BEGIN, (test: mochaTypes.Test) => {
            consoleHijacker.hijack();
            writeReportProgress({
                event: constants.EVENT_TEST_BEGIN,
                title: test.title,
                titlePath: test.titlePath(),
                slow: test.slow(),
                fullTitle: test.fullTitle(),
                isPending: test.isPending(),
                duration: test.duration,
                state: test.state,
                parent: { fullTitle: test.parent?.fullTitle() }
            });
        })
        .on(constants.EVENT_TEST_PENDING, (test: mochaTypes.Test) => {
            consoleHijacker.release();
            writeReportProgress({
                event: constants.EVENT_TEST_PENDING,
                title: test.title,
                titlePath: test.titlePath(),
                slow: test.slow(),
                fullTitle: test.fullTitle(),
                isPending: test.isPending(),
                duration: test.duration,
                state: test.state,
                parent: { fullTitle: test.parent?.fullTitle() }
            });
        })
        .on(constants.EVENT_TEST_PASS, (test: mochaTypes.Test) => {
            consoleHijacker.release();
            writeReportProgress({
                event: constants.EVENT_TEST_PASS,
                title: test.title,
                duration: test.duration,
                state: test.state,
                isPending: test.isPending(),
                parent: { fullTitle: test.parent?.fullTitle() }
            });
        });
}

inherits(CustomReporter, defaultReporter);
module.exports = CustomReporter;
