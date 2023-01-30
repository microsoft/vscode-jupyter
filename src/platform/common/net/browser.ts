// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-var-requires */

import { injectable } from 'inversify';
import { env, Uri } from 'vscode';
import { IBrowserService } from '../types';
import { noop } from '../utils/misc';

export function launch(url: string) {
    env.openExternal(Uri.parse(url)).then(noop, noop);
}

/**
 * Wrapper around the vscode openExternal api
 */
@injectable()
export class BrowserService implements IBrowserService {
    public launch(url: string): void {
        launch(url);
    }
}
