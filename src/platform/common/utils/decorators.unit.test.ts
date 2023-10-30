// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect, use } from 'chai';
import chaiPromise from 'chai-as-promised';
import {
    isUnitTestExecution,
    isTestExecution,
    setUnitTestExecution,
    setTestExecution
} from '../../../platform/common/constants';
import { clearCache } from '../../../platform/common/utils/cacheUtils';
import { cache } from '../../../platform/common/utils/decorators';
import { sleep } from '../../../test/core';
use(chaiPromise);

/* eslint-disable @typescript-eslint/no-explicit-any, , @typescript-eslint/no-extraneous-class */
suite('Common Utils - Decorators', function () {
    // For some reason, sometimes we have timeouts on CI.
    // Note: setTimeout and similar functions are not guaranteed to execute
    // at the precise time prescribed.
    // eslint-disable-next-line no-invalid-this
    this.retries(3);
    suite('Cache Decorator', () => {
        const oldValueOfVSC_JUPYTER_UNIT_TEST = isUnitTestExecution();
        const oldValueOfVSC_JUPYTER_CI_TEST = isTestExecution();

        setup(() => {
            setUnitTestExecution(false);
            setTestExecution(false);
        });

        teardown(() => {
            setUnitTestExecution(oldValueOfVSC_JUPYTER_UNIT_TEST);
            setTestExecution(oldValueOfVSC_JUPYTER_CI_TEST);
            clearCache();
        });
        class TestClass {
            public invoked = false;
            @cache(1000)
            public async doSomething(a: number, b: number): Promise<number> {
                this.invoked = true;
                return a + b;
            }
        }

        test('Result should be cached for 1s', async () => {
            const cls = new TestClass();
            expect(cls.invoked).to.equal(false, 'Wrong initialization value');
            await expect(cls.doSomething(1, 2)).to.eventually.equal(3);
            expect(cls.invoked).to.equal(true, 'Should have been invoked');

            // Reset and ensure it is not updated.
            cls.invoked = false;
            await expect(cls.doSomething(1, 2)).to.eventually.equal(3);
            expect(cls.invoked).to.equal(false, 'Should not have been invoked');
            await expect(cls.doSomething(1, 2)).to.eventually.equal(3);
            expect(cls.invoked).to.equal(false, 'Should not have been invoked');

            // Cache should expire.
            await sleep(2000);

            await expect(cls.doSomething(1, 2)).to.eventually.equal(3);
            expect(cls.invoked).to.equal(true, 'Should have been invoked');
            // Reset and ensure it is not updated.
            cls.invoked = false;
            await expect(cls.doSomething(1, 2)).to.eventually.equal(3);
            expect(cls.invoked).to.equal(false, 'Should not have been invoked');
        }).timeout(3000);
    });
});
