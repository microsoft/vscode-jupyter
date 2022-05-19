// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { injectable } from 'inversify';
import { EXTENSION_ROOT_DIR } from '../../platform/constants.node';
import { IRootDirectory } from './types';

@injectable()
export class RootDirectory implements IRootDirectory {
    public path: string;

    constructor() {
        this.path = EXTENSION_ROOT_DIR;
    }
}
