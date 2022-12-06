// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { ExtensionMode } from 'vscode';
import { isCI } from '../constants';
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

    private readonly testingState = new Map<string, string>();

    public async store(service: string, key: string, value: string | undefined): Promise<void> {
        // On CI we don't need to use keytar for testing (else it hangs).
        if (isCI && this.extensionContext.extensionMode !== ExtensionMode.Production) {
            this.testingState.set(`${service}#${key}`, value || '');
            return;
        }

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
        // On CI we don't need to use keytar for testing (else it hangs).
        if (isCI && this.extensionContext.extensionMode !== ExtensionMode.Production) {
            return this.testingState.get(`${service}#${key}`);
        }
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
