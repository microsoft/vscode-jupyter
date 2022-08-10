// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { injectable } from 'inversify';
import { env } from 'vscode';
import { IClipboard } from './types';

/**
 * Wrapper around the vscode clipboard apis.
 */
@injectable()
export class ClipboardService implements IClipboard {
    public async readText(): Promise<string> {
        return env.clipboard.readText();
    }
    public async writeText(value: string): Promise<void> {
        await env.clipboard.writeText(value);
    }
}
