// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { inject, injectable } from 'inversify';
import { env, ExtensionMode } from 'vscode';
import { IS_REMOTE_NATIVE_TEST } from '../../../test/constants';
import { UseVSCodeNotebookEditorApi } from '../constants';
import { IExtensionContext } from '../types';
import { IAuthenticationService, IEncryptedStorage } from './types';

declare const __webpack_require__: typeof require;
declare const __non_webpack_require__: typeof require;
function getNodeModule<T>(moduleName: string): T | undefined {
    const r = typeof __webpack_require__ === 'function' ? __non_webpack_require__ : require;
    try {
        return r(`${env.appRoot}/node_modules.asar/${moduleName}`);
    } catch (err) {
        // Not in ASAR.
    }
    try {
        return r(`${env.appRoot}/node_modules/${moduleName}`);
    } catch (err) {
        // Not available.
    }
    return undefined;
}

// Use it
type KeyTar = {
    setPassword(service: string, account: string, password: string): Promise<void>;
    deletePassword(service: string, account: string): Promise<void>;
    getPassword(service: string, account: string): Promise<string | undefined>;
};

const keytar = getNodeModule<KeyTar>('keytar');

/**
 * Class that wraps keytar and authentication to provide a way to write out and save a string
 * This class MUST run inside of VS code though
 */
@injectable()
export class EncryptedStorage implements IEncryptedStorage {
    constructor(
        @inject(UseVSCodeNotebookEditorApi) private readonly useNativeNb: boolean,
        @inject(IAuthenticationService) private readonly authenService: IAuthenticationService,
        @inject(IExtensionContext) private readonly extensionContext: IExtensionContext
    ) {}

    private readonly testingState = new Map<string, string>();

    public async store(service: string, key: string, value: string | undefined): Promise<void> {
        // On CI we don't need to use keytar for testing (else it hangs).
        if (IS_REMOTE_NATIVE_TEST && this.extensionContext.extensionMode !== ExtensionMode.Production) {
            this.testingState.set(`${service}#${key}`, value || '');
            return;
        }
        // When not in insiders, use keytar
        if (!this.useNativeNb) {
            if (!value) {
                await keytar?.deletePassword(service, key);
            } else {
                return keytar?.setPassword(service, key, value);
            }
        } else {
            if (!value) {
                await this.authenService.deletePassword(`${service}.${key}`);
            } else {
                await this.authenService.setPassword(`${service}.${key}`, value);
            }
        }
    }
    public async retrieve(service: string, key: string): Promise<string | undefined> {
        // On CI we don't need to use keytar for testing (else it hangs).
        if (IS_REMOTE_NATIVE_TEST && this.extensionContext.extensionMode !== ExtensionMode.Production) {
            return this.testingState.get(`${service}#${key}`);
        }
        // When not in insiders, use keytar
        if (!this.useNativeNb) {
            const val = await keytar?.getPassword(service, key);
            return val ? val : undefined;
        } else {
            // eslint-disable-next-line
            const val = await this.authenService.getPassword(`${service}.${key}`);
            return val;
        }
    }
}
