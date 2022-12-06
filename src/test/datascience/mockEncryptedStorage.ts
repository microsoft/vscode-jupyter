// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IEncryptedStorage } from '../../platform/common/application/types';

/**
 * Mock for encrypted storage. Doesn't do anything except hold values in memory (keytar doesn't work without a UI coming up on Mac/Linux)
 */
export class MockEncryptedStorage implements IEncryptedStorage {
    private map = new Map<string, string>();
    public async store(service: string, key: string, value: string | undefined): Promise<void> {
        const trueKey = `${service}.${key}`;
        if (value) {
            this.map.set(trueKey, value);
        } else {
            this.map.delete(trueKey);
        }
    }
    public async retrieve(service: string, key: string): Promise<string | undefined> {
        const trueKey = `${service}.${key}`;
        return this.map.get(trueKey);
    }
}
