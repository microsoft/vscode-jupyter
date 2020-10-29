// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { parse, ParseError } from 'jsonc-parser';
import * as path from 'path';
import { IApplicationEnvironment, IWorkspaceService } from '../common/application/types';
import { traceError } from '../common/logger';
import { IFileSystem } from '../common/platform/types';
import { Resource } from '../common/types';
import { swallowExceptions } from '../common/utils/decorators';
import { IJupyterServerUriStorage } from '../datascience/types';
import { traceDecorators } from '../logging';
import { IExtensionActivationService } from './types';

@injectable()
export class MigrateDataScienceSettingsService implements IExtensionActivationService {
    constructor(
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IApplicationEnvironment) private readonly application: IApplicationEnvironment,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage
    ) {}

    public async activate(resource: Resource): Promise<void> {
        this.updateSettings(resource).ignoreErrors();
    }

    @swallowExceptions('Failed to update settings.json')
    public async fixSettingInFile(filePath: string): Promise<string> {
        const fileContents = await this.fs.readLocalFile(filePath);
        const errors: ParseError[] = [];
        const content = parse(fileContents, errors, { allowTrailingComma: true, disallowComments: false });
        if (errors.length > 0) {
            traceError('JSONC parser returned ParseError codes', errors);
        }

        // Find all of the python.datascience entries
        const dataScienceKeys = Object.keys(content).filter((f) => f.includes('python.dataScience'));

        // Write all of these keys to jupyter tags
        dataScienceKeys.forEach((k) => {
            const val = content[k];
            delete content[k];
            // Special case. URI is no longer supported. Move it to storage
            if (k === 'python.dataScience.jupyterServerURI') {
                this.serverUriStorage.setUri(val).ignoreErrors();
            } else {
                content[`jupyter.${k.substr(18)}`] = val;
            }
        });

        await this.fs.writeLocalFile(filePath, JSON.stringify(content, undefined, 2));
        return fileContents;
    }

    @traceDecorators.error('Failed to update test settings')
    private async updateSettings(resource: Resource): Promise<void> {
        const filesToBeFixed = await this.getFilesToBeFixed(resource);
        await Promise.all(filesToBeFixed.map((file) => this.fixSettingInFile(file)));
    }

    private getSettingsFiles(resource: Resource): string[] {
        const settingsFiles: string[] = [];
        if (this.application.userSettingsFile) {
            settingsFiles.push(this.application.userSettingsFile);
        }
        const workspaceFolder = this.workspace.getWorkspaceFolder(resource);
        if (workspaceFolder) {
            settingsFiles.push(path.join(workspaceFolder.uri.fsPath, '.vscode', 'settings.json'));
        }
        return settingsFiles;
    }

    private async getFilesToBeFixed(resource: Resource): Promise<string[]> {
        const files = this.getSettingsFiles(resource);
        const result = await Promise.all(
            files.map(async (file) => {
                const needsFixing = await this.doesFileNeedToBeFixed(file);
                return { file, needsFixing };
            })
        );
        return result.filter((item) => item.needsFixing).map((item) => item.file);
    }

    private async doesFileNeedToBeFixed(filePath: string): Promise<boolean> {
        try {
            if (await this.fs.localFileExists(filePath)) {
                const contents = await this.fs.readLocalFile(filePath);
                return contents.indexOf('python.dataScience') > 0;
            } else {
                return false;
            }
        } catch (ex) {
            traceError('Failed to check if settings file needs to be fixed', ex);
            return false;
        }
    }
}
