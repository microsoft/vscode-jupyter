// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect } from 'chai';
import { encode, encodingExists } from 'iconv-lite';
import { BufferDecoder } from '../../../platform/common/process/proc.node';
import { initialize } from '../../initialize.node';

suite('Decoder', () => {
    setup(initialize);
    teardown(initialize);

    test('Test decoding utf8 strings', () => {
        const value = 'Sample input string Сделать это';
        const buffer = encode(value, 'utf8');
        const decoder = new BufferDecoder();
        const decodedValue = decoder.decode([buffer]);
        expect(decodedValue).equal(value, 'Decoded string is incorrect');
    });

    test('Test decoding cp932 strings', function () {
        if (!encodingExists('cp866')) {
            // eslint-disable-next-line no-invalid-this
            this.skip();
        }
        const value = 'Sample input string Сделать это';
        const buffer = encode(value, 'cp866');
        const decoder = new BufferDecoder();
        let decodedValue = decoder.decode([buffer]);
        expect(decodedValue).not.equal(value, 'Decoded string is the same');

        decodedValue = decoder.decode([buffer], 'cp866');
        expect(decodedValue).equal(value, 'Decoded string is incorrect');
    });
});
