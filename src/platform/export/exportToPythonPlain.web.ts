// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { Uri } from 'vscode';
import { writeFile } from '../common/platform/fileSystem';
import { IConfigurationService } from '../common/types';
import { ExportToPythonPlainBase } from './exportToPythonPlain';

// Handles exporting a NotebookDocument to python
@injectable()
export class ExportToPythonPlain extends ExportToPythonPlainBase {
    public constructor(@inject(IConfigurationService) configuration: IConfigurationService) {
        super(configuration);
    }

    override async writeFile(target: Uri, contents: string): Promise<void> {
        await writeFile(target, contents);
    }
}
