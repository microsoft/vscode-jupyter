/* eslint-disable @typescript-eslint/no-explicit-any */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import type * as mochaTypes from 'mocha';
import { workspace } from 'vscode';
import { noop } from '../core';

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
    | { event: typeof constants.EVENT_SUITE_BEGIN; title: string }
    | { event: typeof constants.EVENT_SUITE_END; title: string }
    | {
          event: typeof constants.EVENT_TEST_FAIL;
          title: string;
          err: Exception;
          duration?: number;
      }
    | { event: typeof constants.EVENT_TEST_PENDING; title: string }
    | { event: typeof constants.EVENT_TEST_PASS; title: string; duration?: number };
function sendMessage(url: string, message: Message) {
    fetch(url, {
        method: 'post',
        body: JSON.stringify(message),
        headers: {
            'Content-Type': 'application/json'
        }
    }).catch(noop);
}
function formatException(err: any) {
    const props = ['actual', 'expected', 'operator', 'generatedMessage'];
    const error: Record<string, any> = {
        name: err.name,
        message: err.message,
        stack: err.stack
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
export class CustomReporter {
    private readonly reportServerPor: number;
    constructor(runner: mochaTypes.Runner) {
        console.error(`Created custom reporter`);
        this.reportServerPor = workspace.getConfiguration('jupyter').get('REPORT_SERVER_PORT') as number;

        const url = `http://127.0.0.1:${this.reportServerPor}`;
        console.error(`Started test reporter and writing to ${url}`);
        const reportProgress = (message: Message) => sendMessage(url, message);
        runner
            .once(constants.EVENT_RUN_BEGIN, () => {
                console.error(`Started tests`);
                reportProgress({ event: constants.EVENT_RUN_BEGIN });
            })
            .once(constants.EVENT_RUN_END, async () => {
                reportProgress({ event: constants.EVENT_RUN_END, stats: runner.stats });
            })
            .on(constants.EVENT_SUITE_BEGIN, (suite: mochaTypes.Suite) => {
                reportProgress({ event: constants.EVENT_SUITE_BEGIN, title: suite.fullTitle() });
            })
            .on(constants.EVENT_SUITE_END, (suite: mochaTypes.Suite) => {
                reportProgress({ event: constants.EVENT_SUITE_END, title: suite.fullTitle() });
            })
            .on(constants.EVENT_TEST_FAIL, (test: mochaTypes.Test, err: any) => {
                reportProgress({
                    event: constants.EVENT_TEST_FAIL,
                    title: test.fullTitle(),
                    err: formatException(err),
                    duration: test.duration
                });
            })
            .on(constants.EVENT_TEST_PENDING, (test: mochaTypes.Test) => {
                reportProgress({
                    event: constants.EVENT_TEST_PENDING,
                    title: test.fullTitle()
                });
            })
            .on(constants.EVENT_TEST_PASS, (test: mochaTypes.Test) => {
                reportProgress({
                    event: constants.EVENT_TEST_PASS,
                    title: test.fullTitle(),
                    duration: test.duration
                });
            });
    }
}
