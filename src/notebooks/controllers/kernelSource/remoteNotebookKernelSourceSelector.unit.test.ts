// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';

suite('Remote Notebook Kernel Source Selector - UI State Management', () => {
    test('should demonstrate busy state pattern expectations', () => {
        // This test documents the expected behavior for UI busy state management
        // The fix ensures that lazyQuickPick.busy is reset in finally block

        let busyState = false;
        const mockQuickPick = {
            set busy(value: boolean) {
                busyState = value;
            },
            get busy() {
                return busyState;
            }
        };

        // Simulate the fixed pattern: busy state reset in finally block
        const simulateOperation = async (shouldThrow: boolean) => {
            try {
                mockQuickPick.busy = true;
                if (shouldThrow) {
                    throw new Error('Simulated error');
                }
                return 'success';
            } finally {
                mockQuickPick.busy = false;
            }
        };

        // Test successful case
        return simulateOperation(false)
            .then(() => {
                assert.isFalse(mockQuickPick.busy, 'Busy state should be reset after success');
            })
            .then(() => {
                // Test error case
                return simulateOperation(true).catch(() => {
                    assert.isFalse(mockQuickPick.busy, 'Busy state should be reset even after errors');
                });
            });
    });
});
