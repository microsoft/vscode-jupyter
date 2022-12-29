// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { languages } from 'vscode';
import { IExtensionSyncActivationService } from '../activation/types';
import { VSCodeKnownNotebookLanguages } from '../common/constants';
import { noop } from '../common/utils/misc';

/**
 * Initializes the list of known languages with whats registered in VS Code.
 */
@injectable()
export class LanguageInitializer implements IExtensionSyncActivationService {
    public activate() {
        languages.getLanguages().then((languages) => {
            languages
                .map((language) => language.toLowerCase())
                .forEach((language) => {
                    if (!VSCodeKnownNotebookLanguages.includes(language)) {
                        VSCodeKnownNotebookLanguages.push(language);
                    }
                });
        }, noop);
    }
}
