// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { injectable } from 'inversify';
import * as keytar from 'keytar';
import {
    IEncryptedStorage,
} from '../../client/common/application/types';

/**
 * Class that wraps keytar and authentication to provide a way to write out and save a string
 * This class MUST run outside of VS code
 */
@injectable()
export class MockEncryptedStorage implements IEncryptedStorage {
    public async store(service: string, key: string, value: string | undefined): Promise<void> {
        // When not in insiders, use keytar
        if (!value) {
            await keytar?.deletePassword(service, key);
        } else {
            return keytar?.setPassword(service, key, value);
        }
    }
    public async retrieve(service: string, key: string): Promise<string | undefined> {
        const val = await keytar?.getPassword(service, key);
        return val ? val : undefined;
    }
}
