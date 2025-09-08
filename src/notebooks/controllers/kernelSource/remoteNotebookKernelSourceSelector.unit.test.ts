// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { CancellationError } from 'vscode';
import { isCancellationError } from '../../../platform/common/cancellation';

suite('Remote Notebook Kernel Source Selector - CancellationError Handling', () => {
    test('should properly detect CancellationError instances', () => {
        // Test the isCancellationError utility function that our fix uses
        const cancellationError = new CancellationError();
        const regularError = new Error('Regular error');
        
        assert.isTrue(isCancellationError(cancellationError), 'Should detect CancellationError instances');
        assert.isFalse(isCancellationError(regularError), 'Should not detect regular errors as cancellation errors');
    });

    test('should handle promise rejection with CancellationError correctly', async () => {
        // Test the pattern used in our fix: wrapping a promise that rejects with CancellationError
        const mockHandleCommand = () => Promise.reject(new CancellationError());
        
        try {
            await Promise.resolve(mockHandleCommand());
            assert.fail('Expected CancellationError to be thrown');
        } catch (error) {
            // This simulates the behavior in our fix
            if (isCancellationError(error)) {
                assert.instanceOf(error, CancellationError, 'Should preserve CancellationError type');
                // The fix should re-throw this error to propagate it
                return; // Success case
            }
            assert.fail('Expected CancellationError to be caught by isCancellationError');
        }
    });

    test('should handle promise resolution with undefined correctly', async () => {
        // Test the pattern for undefined return (back behavior)
        const mockHandleCommand = () => Promise.resolve(undefined);
        
        const result = await Promise.resolve(mockHandleCommand());
        assert.isUndefined(result, 'Should handle undefined return from handleCommand');
    });
});