// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { BaseError } from '../../common/errors/types';
import '../../common/extensions';
import { HelpLinks } from '../constants';

export class JupyterInstallError extends BaseError {
    public action: string;
    public actionTitle: string;

    constructor(message: string, actionFormatString: string) {
        super('jupyterinstall', message);
        this.action = HelpLinks.PythonInteractiveHelpLink;
        this.actionTitle = actionFormatString.format(HelpLinks.PythonInteractiveHelpLink);
    }
}
