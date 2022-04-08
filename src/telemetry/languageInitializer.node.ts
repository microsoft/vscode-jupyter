// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { languages } from 'vscode';
import { IExtensionSingleActivationService } from '../platform/activation/types';
import { VSCodeKnownNotebookLanguages } from '../platform/common/constants';
import { noop } from '../platform/common/utils/misc';

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
                    if (!VSCodeKnownNotebookLanguages.includes(language)) {
                        VSCodeKnownNotebookLanguages.push(language);
                    }
                });
        }, noop);
    }
}
