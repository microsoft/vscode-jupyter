// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import * as path from 'path';
import * as uuid from 'uuid/v4';
import { Uri } from 'vscode';
import '../../common/extensions';
import * as localize from '../../common/utils/localize';

let identities: string[] = [];
let createCount = 0;

export function createInteractiveIdentity(): Uri {
    if (createCount > 0 || identities.length <= 0) {
        identities.push(uuid());
    }
    createCount += 1;
    return Uri.parse(`history://${identities[identities.length - 1]}`);
}

export function getInteractiveWindowTitle(owner: Uri): string {
    return localize.DataScience.interactiveWindowTitleFormat().format(path.basename(owner.fsPath));
}
