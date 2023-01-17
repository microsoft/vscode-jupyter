// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from '../platform/vscode-path/path';
import { Uri } from 'vscode';
import '../platform/common/extensions';
import * as localize from '../platform/common/utils/localize';

export function getInteractiveWindowTitle(owner: Uri): string {
    return localize.DataScience.interactiveWindowTitleFormat(path.basename(owner.path));
}
