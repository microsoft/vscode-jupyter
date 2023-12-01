// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-var-requires */

import { env, Uri } from 'vscode';
import { noop } from '../utils/misc';

export function openInBrowser(url: string | Uri) {
    env.openExternal(typeof url === 'string' ? Uri.parse(url) : url).then(noop, noop);
}
