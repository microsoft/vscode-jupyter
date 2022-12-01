// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { traceError } from '../../logging';
import { IExtensionContext } from '../types';
import { IEncryptedStorage } from './types';

/**
 * Class that wraps keytar and authentication to provide a way to write out and save a string
 * This class MUST run inside of VS code though
 */
@injectable()
export class EncryptedStorage implements IEncryptedStorage {
    constructor(@inject(IExtensionContext) private readonly extensionContext: IExtensionContext) {}

    public async store(service: string, key: string, value: string | undefined): Promise<void> {
        if (!value) {
            try {
                await this.extensionContext.secrets.delete(`${service}.${key}`);
            } catch (e) {
                traceError(e);
            }
        } else {
            await this.extensionContext.secrets.store(`${service}.${key}`, value);
        }
    }
    public async retrieve(service: string, key: string): Promise<string | undefined> {
        try {
            // eslint-disable-next-line
            const val = await this.extensionContext.secrets.get(`${service}.${key}`);
            return val;
        } catch (e) {
            // If we get an error trying to get a secret, it might be corrupted. So we delete it.
            try {
                await this.extensionContext.secrets.delete(`${service}.${key}`);
                return;
            } catch (e) {
                traceError(e);
            }
        }
    }
}
