// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { IFileSystem } from '../common/platform/types';
import { IConfigurationService } from '../common/types';
import { ExportToPythonPlainBase } from './exportToPythonPlain';

// Handles exporting a NotebookDocument to python
@injectable()
export class ExportToPythonPlain extends ExportToPythonPlainBase {
    public constructor(
        @inject(IFileSystem) fs: IFileSystem,
        @inject(IConfigurationService) configuration: IConfigurationService
    ) {
        super(fs, configuration);
    }
}
