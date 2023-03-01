// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { deepStrictEqual } from 'assert';
import { getPngDimensions } from './plotViewHandler';

suite('PlotViewHandler', () => {
    suite('getPngDimensions', () => {
        test('should get correct dimensions for test files', async () => {
            const t = new Uint8Array([
                // PNG signature
                0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
                // Chunk length
                0x00, 0x00, 0x00, 0x0d,
                // Chunk type "IHDR"
                0x49, 0x48, 0x44, 0x52,
                // Image height
                0x00, 0x00, 0x04, 0x2a,
                // Image width
                0x00, 0x00, 0x04, 0x2b,
                // Rest of IHDR and other
                0x08, 0x02, 0x00, 0x00, 0x00, 0xc5, 0x6b, 0x38
            ]);
            deepStrictEqual(getPngDimensions(Buffer.from(t)), {
                height: 1067,
                width: 1066
            });
        });
    });
});
