// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect, use } from 'chai';
import chaiPromise from 'chai-as-promised';
import * as sinon from 'sinon';
import {
    isUnitTestExecution,
    isTestExecution,
    setUnitTestExecution,
    setTestExecution
} from '../../../platform/common/constants';
import { clearCache } from '../../../platform/common/utils/cacheUtils';
import { cache } from '../../../platform/common/utils/decorators';
use(chaiPromise);

/* eslint-disable @typescript-eslint/no-explicit-any, , @typescript-eslint/no-extraneous-class */
suite('Common Utils - Decorators', () => {
    suite('Cache Decorator', () => {
        const oldValueOfVSC_JUPYTER_UNIT_TEST = isUnitTestExecution();
        const oldValueOfVSC_JUPYTER_CI_TEST = isTestExecution();
        let clock: sinon.SinonFakeTimers;

        setup(() => {
            clock = sinon.useFakeTimers();
            setUnitTestExecution(false);
            setTestExecution(false);
        });

        teardown(() => {
            clock.restore();
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

            // Cache should expire after 1s; advance fake clock by 2s.
            await clock.tickAsync(2000);

            await expect(cls.doSomething(1, 2)).to.eventually.equal(3);
            expect(cls.invoked).to.equal(true, 'Should have been invoked');
            // Reset and ensure it is not updated.
            cls.invoked = false;
            await expect(cls.doSomething(1, 2)).to.eventually.equal(3);
            expect(cls.invoked).to.equal(false, 'Should not have been invoked');
        });
    });
});
