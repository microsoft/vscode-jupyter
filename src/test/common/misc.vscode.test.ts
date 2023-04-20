// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect } from 'chai';
import { isTestExecution } from '../../platform/common/constants';

// Defines a Mocha test suite to group tests of similar kind together
suite('Common - Misc', () => {
    test("Ensure its identified that we're running unit tests", () => {
        expect(isTestExecution()).to.be.equal(true, 'incorrect');
    });
});
