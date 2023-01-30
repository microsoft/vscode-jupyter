// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { formatStreamText } from '../../platform/common/utils';

suite('Common Tests', () => {
    test('formatting stream text', async () => {
        assert.equal(formatStreamText('\rExecute\rExecute 1'), 'Execute 1');
        assert.equal(formatStreamText('\rExecute\r\nExecute 2'), 'Execute\nExecute 2');
        assert.equal(formatStreamText('\rExecute\rExecute\r\nExecute 3'), 'Execute\nExecute 3');
        assert.equal(formatStreamText('\rExecute\rExecute\nExecute 4'), 'Execute\nExecute 4');
        assert.equal(formatStreamText('\rExecute\r\r \r\rExecute\nExecute 5'), 'Execute\nExecute 5');
        assert.equal(formatStreamText('\rExecute\rExecute\nExecute 6\rExecute 7'), 'Execute\nExecute 7');
        assert.equal(formatStreamText('\rExecute\rExecute\nExecute 8\rExecute 9\r\r'), 'Execute\nExecute 9');
        assert.equal(formatStreamText('\rExecute\rExecute\nExecute 10\rExecute 11\r\n'), 'Execute\nExecute 11\n');
    });
});
