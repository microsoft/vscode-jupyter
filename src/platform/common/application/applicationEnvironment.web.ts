// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { injectable } from 'inversify';
import { BaseApplicationEnvironment } from './applicationEnvironment.base';

@injectable()
export class ApplicationEnvironment extends BaseApplicationEnvironment {
    public get userSettingsFile(): string | undefined {
        return undefined;
    }
    public get userCustomKeybindingsFile(): string | undefined {
        return undefined;
    }
}
