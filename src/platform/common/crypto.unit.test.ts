// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { CryptoUtils } from './crypto';

suite('Crypto Utils', async () => {
    let crypto: CryptoUtils;
    setup(() => {
        crypto = new CryptoUtils();
    });

    test('If hashFormat equals `string`, method createHash() returns a string', async () => {
        const hash = await crypto.createHash('blabla');
        assert.typeOf(hash, 'string', 'Type should be a string');
    });
    test('Hashes must be same for same strings (sha256)', async () => {
        const hash1 = await crypto.createHash('blabla', 'SHA-256');
        const hash2 = await crypto.createHash('blabla', 'SHA-256');
        assert.equal(hash1, hash2);
    });
    test('Hashes must be different for different strings (sha256)', async () => {
        const hash1 = await crypto.createHash('Hello', 'SHA-256');
        const hash2 = await crypto.createHash('World', 'SHA-256');
        assert.notEqual(hash1, hash2);
    });
    test('If hashFormat equals `string`, the hash should not be undefined', async () => {
        let hash = await crypto.createHash('test');
        assert.isDefined(hash, 'String hash should not be undefined');
        hash = await crypto.createHash('hash');
        assert.isDefined(hash, 'String hash should not be undefined');
        hash = await crypto.createHash('HASH1');
        assert.isDefined(hash, 'String hash should not be undefined');
    });
    test('If hashFormat equals `string`, hashes with different data should return different string hashes', async () => {
        const hash1 = await crypto.createHash('hash1');
        const hash2 = await crypto.createHash('hash2');
        assert.notEqual(hash1, hash2, 'Hashes should be different strings');
    });
});
