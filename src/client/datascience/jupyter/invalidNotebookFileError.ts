// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { BaseError } from '../../common/errors';
import '../../common/extensions';
import * as localize from '../../common/utils/localize';

export class InvalidNotebookFileError extends BaseError {
    constructor(file?: string) {
        super(
            'unknown',
            file
                ? localize.DataScience.invalidNotebookFileErrorFormat().format(file)
                : localize.DataScience.invalidNotebookFileError()
        );
    }
}
