// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import { traceInfo } from '../platform/common/logger';
import { captureScreenShot } from './common';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('DataScience - Verify serviceRegistry is correct', function () {
    setup(async function () {
        try {
            traceInfo(`Start Test ${this.currentTest?.title}`);
            traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
        } catch (e) {
            await captureScreenShot(this.currentTest?.title || 'unknown');
            throw e;
        }
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    test('Verify all classes with inject on them are in the container', async () => {
        assert.ok(false, `Test not written yet`);
    });
});
