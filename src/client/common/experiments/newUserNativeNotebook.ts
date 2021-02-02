// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, named } from 'inversify';
import { Memento } from 'vscode';
import { IApplicationEnvironment } from '../application/types';
import { traceError, traceWarning } from '../logger';
import { GLOBAL_MEMENTO, IHttpClient, IMemento } from '../types';
import { sleep } from '../utils/async';
import { Experiments } from './groups';

export const configUri = 'https://raw.githubusercontent.com/microsoft/vscode-jupyter/master/experiments.json';
export class NewUserNativeNotebookService {
    constructor(
        @inject(IHttpClient) private readonly httpClient: IHttpClient,
        @inject(IApplicationEnvironment) private readonly appEnv: IApplicationEnvironment,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalState: Memento
    ) {}
    public async activate(isFirstTimeUser: boolean): Promise<void> {
        // If this is not a first time user, then we don't care.
        if (!isFirstTimeUser) {
            return;
        }
        // If this is insiders, then exit (we only care about stable).
        if (this.appEnv.channel === 'insiders') {
            return;
        }

        // If experiment was already disabled for this user
        // Or if user is already in the experiment, then no need to check on the server.
        if (
            !this.globalState.get<boolean>('USER_CAN_BE_IN_NATIVE_NOTEBOOK_EXP', true) ||
            this.globalState.get('IS_IN_NATIVE_NOTEBOOK_NEW_USER_EXP', false)
        ) {
            return;
        }

        // Timeout after n seconds, we don't want to slow down activation of extension.
        const enabled = await Promise.race([
            this.isNewUserExperimentEnabledOnServer(),
            sleep(60_000).then(() => {
                traceWarning('Timed out waiting to retrieve Experiments file');
                return true;
            })
        ]);
        if (!enabled) {
            await this.globalState.update('USER_CAN_BE_IN_NATIVE_NOTEBOOK_EXP', false);
        }
    }
    private async isNewUserExperimentEnabledOnServer() {
        try {
            const experiments = await this.httpClient.getJSON<string[]>(configUri, false);
            return experiments.includes(Experiments.NativeNotebook);
        } catch (ex) {
            traceError('Failed to fetch experiment details from GithHub', ex);
            return false;
        }
    }
}
