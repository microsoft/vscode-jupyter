// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { languages } from 'vscode';
import { IExtensionSingleActivationService } from '../activation/types';
import { noop } from '../common/utils/misc';
import { KnownNotebookLanguages } from '../datascience/constants';

/**
 * Initializes the list of known languages with whats registered in VS Code.
 */
@injectable()
export class LanguageInitializer implements IExtensionSingleActivationService {
    public async activate() {
        languages.getLanguages().then((languages) => {
            languages
                .map((language) => language.toLowerCase())
                .forEach((language) => {
                    if (!KnownNotebookLanguages.includes(language)) {
                        KnownNotebookLanguages.push(language);
                    }
                });
        }, noop);
    }
}
