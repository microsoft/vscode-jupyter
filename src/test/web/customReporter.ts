/* eslint-disable @typescript-eslint/no-explicit-any */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Runner, reporters, Suite, Test, Stats } from 'mocha';
import { workspace } from 'vscode';
import { noop } from '../core';

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
    | { event: typeof Runner.constants.EVENT_RUN_BEGIN }
    | { event: typeof Runner.constants.EVENT_RUN_END; stats?: Stats }
    | { event: typeof Runner.constants.EVENT_SUITE_BEGIN; title: string }
    | {
          event: typeof Runner.constants.EVENT_TEST_FAIL;
          title: string;
          err: Exception;
          duration?: number;
      }
    | { event: typeof Runner.constants.EVENT_TEST_PENDING; title: string }
    | { event: typeof Runner.constants.EVENT_TEST_PASS; title: string; duration?: number };
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
export class CustomReporter extends reporters.Base {
    private readonly reportServerPor: number;
    constructor(runner: Runner) {
        super(runner);
        this.reportServerPor = workspace.getConfiguration('jupyter').get('reportServerPort') as number;
        const url = `http://localhost:${this.reportServerPor}`;
        const reportProgress = (message: Message) => sendMessage(url, message);
        runner
            .once(Runner.constants.EVENT_RUN_BEGIN, () => {
                reportProgress({ event: Runner.constants.EVENT_RUN_BEGIN });
            })
            .once(Runner.constants.EVENT_RUN_END, async () => {
                reportProgress({ event: Runner.constants.EVENT_RUN_END, stats: runner.stats });
            })
            .on(Runner.constants.EVENT_SUITE_BEGIN, (suite: Suite) => {
                reportProgress({ event: Runner.constants.EVENT_SUITE_BEGIN, title: suite.fullTitle() });
            })
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .on(Runner.constants.EVENT_TEST_FAIL, (test: Test, err: any) => {
                reportProgress({
                    event: Runner.constants.EVENT_TEST_FAIL,
                    title: test.fullTitle(),
                    err: formatException(err),
                    duration: test.duration
                });
                // const durationSuffix = test.duration ? ` after ${test.duration / 1000}s` : '';
                // reportProgress(`${colors.red('✕ Failed')}: ${test.fullTitle()}${durationSuffix}\n${err.toString()}`);
            })
            .on(Runner.constants.EVENT_TEST_PENDING, (test: Test) => {
                reportProgress({
                    event: Runner.constants.EVENT_TEST_PENDING,
                    title: test.fullTitle()
                });
                // const durationSuffix = test.duration ? ` in ${test.duration / 1000}s` : '';
                // reportProgress(`${colors.green('✓ Passed')}: ${test.fullTitle()}${durationSuffix}`);
            })
            .on(Runner.constants.EVENT_TEST_PASS, (test: Test) => {
                reportProgress({
                    event: Runner.constants.EVENT_TEST_PASS,
                    title: test.fullTitle(),
                    duration: test.duration
                });
                // reportProgress(`${colors.yellow(`Skipped'): ${test.fullTitle()}`)}`);
            });
    }
}
