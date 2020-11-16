// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { applyEdits, ModificationOptions, modify, parse, ParseError } from 'jsonc-parser';
import * as path from 'path';
import { IApplicationEnvironment, IWorkspaceService } from '../common/application/types';
import { traceError } from '../common/logger';
import { IFileSystem } from '../common/platform/types';
import { Resource } from '../common/types';
import { swallowExceptions } from '../common/utils/decorators';
import { Settings } from '../datascience/constants';
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
        await this.updateSettings(resource);
    }

    @swallowExceptions('Failed to update settings.json')
    private async fixSettingsFile(filePath: string) {
        let fileContents = await this.fs.readLocalFile(filePath);
        const errors: ParseError[] = [];
        const content = parse(fileContents, errors, { allowTrailingComma: true, disallowComments: false });
        if (errors.length > 0) {
            traceError('JSONC parser returned ParseError codes', errors);
            return;
        }

        // Find all of the python.datascience entries
        const dataScienceKeys = Object.keys(content).filter((f) => f.includes('python.dataScience'));

        // Write all of these keys to jupyter tags
        const modificationOptions: ModificationOptions = {
            formattingOptions: {
                tabSize: 4,
                insertSpaces: true
            }
        };
        dataScienceKeys.forEach((k) => {
            let val = content[k];
            // Remove from the original string
            fileContents = applyEdits(fileContents, modify(fileContents, [k], undefined, modificationOptions));

            // Special case. URI is no longer supported. Move it to storage
            if (k === 'python.dataScience.jupyterServerURI') {
                this.serverUriStorage.setUri(val).ignoreErrors();

                // Set the setting to local or remote based on if URI is 'local'
                val = val === Settings.JupyterServerLocalLaunch ? val : Settings.JupyterServerRemoteLaunch;

                // Change the key to the jupyter version (still needs the 19 chars in front so it substr correctly)
                k = 'xxxxxx.dataScience.jupyterServerType';
            }

            // If the value contains references to python.dataScience.* commands, migrate those too
            if (typeof val === 'string') {
                // There may be multiple occurrences of commands in the object value
                val = val.replace(/python\.dataScience\./gi, 'jupyter.');
            }

            // Update the new value
            fileContents = applyEdits(
                fileContents,
                modify(fileContents, [`jupyter.${k.substr(19)}`], val, modificationOptions)
            );
        });

        await this.fs.writeLocalFile(filePath, fileContents);
    }

    // Users may have mapped old python.dataScience.* commands to custom keybindings
    // in their user keybindings.json. Ensure we migrate these too.
    private async fixKeybindingsFile(filePath: string) {
        const fileContents = await this.fs.readLocalFile(filePath);
        const errors: ParseError[] = [];
        const keybindings = parse(fileContents, errors, { allowTrailingComma: true, disallowComments: false });
        if (errors.length > 0) {
            traceError('JSONC parser returned ParseError codes', errors);
            return;
        }
        if (!Array.isArray(keybindings)) {
            return;
        }
        keybindings.forEach((keybinding) => {
            if (typeof keybinding.command === 'string') {
                keybinding.command = keybinding.command.replace('python.dataScience.', 'jupyter.');
            }
        });
        const migratedKeybindings = JSON.stringify(keybindings, undefined, 4);
        await this.fs.writeLocalFile(filePath, migratedKeybindings);
    }

    @traceDecorators.error('Failed to update test settings')
    private async updateSettings(resource: Resource): Promise<void> {
        const filesToBeFixed = (await this.getFilesToBeFixed(resource)).map((file) => this.fixSettingsFile(file));
        const userCustomKeybindingsFile = this.application.userCustomKeybindingsFile;
        if (userCustomKeybindingsFile && (await this.fs.localFileExists(userCustomKeybindingsFile))) {
            filesToBeFixed.push(this.fixKeybindingsFile(userCustomKeybindingsFile));
        }
        await Promise.all(filesToBeFixed);
    }

    private getSettingsFiles(resource: Resource): string[] {
        const settingsFiles: string[] = [];
        if (this.application.userSettingsFile) {
            settingsFiles.push(this.application.userSettingsFile);
        }
        const workspaceFolder = this.workspace.getWorkspaceFolder(resource);
        if (workspaceFolder && workspaceFolder.uri) {
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
                return contents.indexOf('python.dataScience.') > 0;
            } else {
                return false;
            }
        } catch (ex) {
            traceError('Failed to check if settings file needs to be fixed', ex);
            return false;
        }
    }
}
