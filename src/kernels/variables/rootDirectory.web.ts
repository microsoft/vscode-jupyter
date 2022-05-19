// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { inject, injectable } from 'inversify';
import { IExtensionContext } from '../../platform/common/types';
import { IRootDirectory } from './types';

@injectable()
export class RootDirectory implements IRootDirectory {
    public path: string;

    constructor(@inject(IExtensionContext) context: IExtensionContext) {
        this.path = context.extensionUri.path;
    }
}
