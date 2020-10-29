// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { inject, injectable } from 'inversify';
import * as keytar from 'keytar';
import { IEncryptedStorage, IApplicationEnvironment, IAuthenticationService } from '../../client/common/application/types';

/**
 * Class that wraps keytar and authentication to provide a way to write out and save a string
 * This class MUST run outside of VS code
 */
@injectable()
export class MockEncryptedStorage implements IEncryptedStorage {
    constructor(
        @inject(IApplicationEnvironment) private readonly appEnv: IApplicationEnvironment,
        @inject(IAuthenticationService) private readonly authenService: IAuthenticationService
    ) {}

    public async store(service: string, key: string, value: string | undefined): Promise<void> {
        // When not in insiders, use keytar
        if (this.appEnv.channel !== 'insiders') {
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
        // When not in insiders, use keytar
        if (this.appEnv.channel !== 'insiders') {
            const val = await keytar?.getPassword(service, key);
            return val ? val : undefined;
        } else {
            // tslint:disable-next-line: no-unnecessary-local-variable
            const val = await this.authenService.getPassword(`${service}.${key}`);
            return val;
        }
    }
}
