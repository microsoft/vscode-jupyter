// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { applyEdits, ModificationOptions, modify, parse, ParseError } from 'jsonc-parser';
import * as path from 'path';
import { IApplicationEnvironment, IWorkspaceService } from '../common/application/types';
import { traceError } from '../common/logger';
import { IFileSystem } from '../common/platform/types';
import { IPersistentStateFactory, Resource } from '../common/types';
import { swallowExceptions } from '../common/utils/decorators';
import { Settings } from '../datascience/constants';
import { IJupyterServerUriStorage } from '../datascience/types';
import { traceDecorators } from '../logging';
import { IExtensionActivationService } from './types';

interface IKeyBinding {
    when?: string;
    key: string;
    command: string;
}

@injectable()
export class MigrateDataScienceSettingsService implements IExtensionActivationService {
    constructor(
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IApplicationEnvironment) private readonly application: IApplicationEnvironment,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(IPersistentStateFactory) private readonly persistentStateFactory: IPersistentStateFactory,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage
    ) {}

    public async activate(resource: Resource): Promise<void> {
        // Only perform the migrate once
        const migrated = this.persistentStateFactory.createGlobalPersistentState(
            'MigratedDataScienceSettingsService',
            false
        );
        if (!migrated.value) {
            await this.updateSettings(resource);
            migrated.updateValue(true).ignoreErrors();
        }
    }

    @swallowExceptions('Failed to update settings.json')
    private async fixSettingsFile(filePath: string) {
        let fileContents = await this.fs.readLocalFile(filePath);

        if (!fileContents.includes('python.dataScience')) {
            return;
        }

        const errors: ParseError[] = [];
        const content: Object = parse(fileContents, errors, { allowTrailingComma: true, disallowComments: false });
        if (errors.length > 0) {
            traceError('JSONC parser returned ParseError codes', errors);
            return;
        }

        // Find all of the python.datascience entries
        const keys = Object.keys(content);
        const dataScienceKeys = keys.filter((f) => f.startsWith('python.dataScience'));

        if (dataScienceKeys.length === 0) {
            return;
        }

        // Write all of these keys to jupyter tags
        const modificationOptions: ModificationOptions = {
            formattingOptions: {
                tabSize: 4,
                insertSpaces: true
            }
        };

        dataScienceKeys.forEach((k) => {
            // Remove all data science keys from the original string
            fileContents = applyEdits(fileContents, modify(fileContents, [k], undefined, modificationOptions));

            // tslint:disable-next-line: no-any
            let val = (content as any)[k];
            const subkey = k.substr(19);
            let newKey = `jupyter.${subkey}`;
            if (subkey === 'jupyterServerURI' && !content.hasOwnProperty('jupyter.jupyterServerType')) {
                // Special case. URI is no longer supported. Move it to storage
                this.serverUriStorage.setUri(val).ignoreErrors();
                newKey = 'jupyter.jupyterServerType';

                // Set the setting to local or remote based on if URI is 'local'
                val = val === Settings.JupyterServerLocalLaunch ? val : Settings.JupyterServerRemoteLaunch;
            } else if (!content.hasOwnProperty(newKey)) {
                if (typeof val === 'string') {
                    // If the value contains references to python.dataScience.* commands, migrate those too
                    // There may be multiple occurrences of commands in the object value
                    val = val.replace(/python\.datascience\./gi, 'jupyter.');
                }
            }

            // Update the new value
            fileContents = applyEdits(fileContents, modify(fileContents, [newKey], val, modificationOptions));
        });

        await this.fs.writeLocalFile(filePath, fileContents);
    }

    // Users may have mapped old python.datascience.* commands to custom keybindings
    // in their user keybindings.json. Ensure we migrate these too.
    private async fixKeybindingsFile(filePath: string) {
        const fileContents = await this.fs.readLocalFile(filePath);
        if (!fileContents.includes('python.datascience.')) {
            return;
        }
        const errors: ParseError[] = [];
        const keybindings = parse(fileContents, errors, { allowTrailingComma: true, disallowComments: false });
        if (errors.length > 0) {
            traceError('JSONC parser returned ParseError codes', errors);
            return;
        }
        if (!Array.isArray(keybindings)) {
            return;
        }
        // Possible the user already migrated the setting themselves
        // Ensure we don't migrate a setting if the replacement command already exists
        const jupyterCommands = keybindings.map((keybinding) => {
            const command = keybinding.command;
            if (typeof command === 'string' && command.includes('jupyter.')) {
                return command;
            }
        });
        const migratedKeybindings: IKeyBinding[] = [];
        keybindings.forEach((keybinding) => {
            const command = keybinding.command;
            if (typeof command === 'string' && command.includes('python.datascience.')) {
                const targetCommand = command.replace(/python\.datascience\./gi, 'jupyter.');
                // Only migrate if the user doesn't already have an entry in the keybindings.json
                // for the new jupyter.* equivalent of this command
                if (!jupyterCommands.includes(targetCommand)) {
                    keybinding.command = targetCommand;
                    // If we migrate the command, also migrate any python.datascience context
                    // keys that might exist in a when clause
                    const whenClause = keybinding.when;
                    if (whenClause && typeof whenClause === 'string') {
                        keybinding.when = whenClause.replace(/python\.datascience\./gi, 'jupyter.');
                    }
                    migratedKeybindings.push(keybinding);
                }
                // If user already has a new custom keybinding for the target command,
                // don't migrate and also don't leave the old python.datascience.*
                // keybinding behind
            } else {
                // Not a python.datascience keybinding, leave it alone
                migratedKeybindings.push(keybinding);
            }
        });

        await this.fs.writeLocalFile(filePath, JSON.stringify(migratedKeybindings, undefined, 4));
    }

    @traceDecorators.error('Failed to update test settings')
    private async updateSettings(resource: Resource): Promise<void> {
        const filesToBeFixed = this.getSettingsFiles(resource).map((file) => this.fixSettingsFile(file));
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
}
