import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import { isNotInstalledError } from '../../client/common/helpers';

// Defines a Mocha test suite to group tests of similar kind together
suite('helpers', () => {
    test('isNotInstalledError', (done) => {
        const error = new Error('something is not installed');
        assert.equal(isNotInstalledError(error), false, 'Standard error');

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (error as any).code = 'ENOENT';
        assert.equal(isNotInstalledError(error), true, 'ENOENT error code not detected');

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (error as any).code = 127;
        assert.equal(isNotInstalledError(error), true, '127 error code not detected');

        done();
    });
});
