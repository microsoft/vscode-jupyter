/* eslint-disable @typescript-eslint/no-explicit-any */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import type * as mochaTypes from 'mocha';
import { env, extensions, UIKind, Uri, workspace } from 'vscode';
import { JVSC_EXTENSION_ID_FOR_TESTS } from '../constants';
import { noop } from '../core';
const { inherits } = require('mocha/lib/utils');
const defaultReporter = require('mocha/lib/reporters/spec');

const constants = {
    EVENT_RUN_BEGIN: 'start',
    EVENT_RUN_END: 'end',
    EVENT_SUITE_BEGIN: 'suite',
    EVENT_SUITE_END: 'suite end',
    EVENT_TEST_FAIL: 'fail',
    EVENT_TEST_PENDING: 'pending',
    EVENT_TEST_PASS: 'pass'
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
type Message =
    | { event: typeof constants.EVENT_RUN_BEGIN }
    | { event: typeof constants.EVENT_RUN_END; stats?: mochaTypes.Stats }
    | { event: typeof constants.EVENT_SUITE_BEGIN; title: string; titlePath: string[]; fullTitle: string }
    | { event: typeof constants.EVENT_SUITE_END; title: string; slow: number; titlePath: string[]; fullTitle: string }
    | {
          event: typeof constants.EVENT_TEST_FAIL;
          title: string;
          err: Exception;
          duration?: number;
          titlePath: string[];
          fullTitle: string;
          slow: number;
      }
    | {
          event: typeof constants.EVENT_TEST_PENDING;
          title: string;
          titlePath: string[];
          fullTitle: string;
          slow: number;
      }
    | {
          event: typeof constants.EVENT_TEST_PASS;
          title: string;
          duration?: number;
          titlePath: string[];
          fullTitle: string;
          slow: number;
      };
let currentPromise = Promise.resolve();
const messages: Message[] = [];
let url = '';

function writeReportProgress(message: Message) {
    if (env.uiKind === UIKind.Desktop) {
        messages.push(message);
        if (message.event === constants.EVENT_RUN_END) {
            const ext = extensions.getExtension(JVSC_EXTENSION_ID_FOR_TESTS)!.extensionUri;
            const logFile = Uri.joinPath(ext, 'webtest.json');
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

function CustomReporter(this: any, runner: mochaTypes.Runner, options: mochaTypes.MochaOptions) {
    defaultReporter.call(this, runner, options);
    console.error(`Created custom reporter`);
    runner
        .once(constants.EVENT_RUN_BEGIN, () => {
            console.error(`Started tests`);
            writeReportProgress({ event: constants.EVENT_RUN_BEGIN });
        })
        .once(constants.EVENT_RUN_END, () => {
            console.error('Writing the end of the test run');
            writeReportProgress({ event: constants.EVENT_RUN_END, stats: runner.stats });
        })
        .on(constants.EVENT_SUITE_BEGIN, (suite: mochaTypes.Suite) => {
            writeReportProgress({
                event: constants.EVENT_SUITE_BEGIN,
                title: suite.title,
                titlePath: suite.titlePath(),
                fullTitle: suite.fullTitle()
            });
        })
        .on(constants.EVENT_SUITE_END, (suite: mochaTypes.Suite) => {
            writeReportProgress({
                event: constants.EVENT_SUITE_END,
                title: suite.title,
                titlePath: suite.titlePath(),
                slow: suite.slow(),
                fullTitle: suite.fullTitle()
            });
        })
        .on(constants.EVENT_TEST_FAIL, (test: mochaTypes.Test, err: any) => {
            writeReportProgress({
                event: constants.EVENT_TEST_FAIL,
                title: test.title,
                err: formatException(err),
                duration: test.duration,
                titlePath: test.titlePath(),
                slow: test.slow(),
                fullTitle: test.fullTitle()
            });
        })
        .on(constants.EVENT_TEST_PENDING, (test: mochaTypes.Test) => {
            writeReportProgress({
                event: constants.EVENT_TEST_PENDING,
                title: test.title,
                titlePath: test.titlePath(),
                slow: test.slow(),
                fullTitle: test.fullTitle()
            });
        })
        .on(constants.EVENT_TEST_PASS, (test: mochaTypes.Test) => {
            writeReportProgress({
                event: constants.EVENT_TEST_PASS,
                title: test.title,
                duration: test.duration
            });
        });
}
inherits(CustomReporter, defaultReporter);
module.exports = CustomReporter;
