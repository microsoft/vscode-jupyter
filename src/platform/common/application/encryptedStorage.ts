// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { IEncryptedStorage } from './types';

/**
 * Class that wraps keytar and authentication to provide a way to write out and save a string
 * This class MUST run inside of VS code though
 */
@injectable()
export class EncryptedStorage implements IEncryptedStorage {
    private readonly testingState = new Map<string, string>();

    public async store(service: string, key: string, value: string | undefined): Promise<void> {
        this.testingState.set(`${service}#${key}`, value || '');
    }
    public async retrieve(service: string, key: string): Promise<string | undefined> {
        return this.testingState.get(`${service}#${key}`);
    }
}
