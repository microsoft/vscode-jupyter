// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { IJupyterExtraSettings } from '../../../../../platform/webviews/types';
import { detectBaseTheme } from '../../../react-common/themeDetector';

export namespace Helpers {
    export function computeKnownDark(settings?: IJupyterExtraSettings): boolean {
        const ignore = settings?.ignoreVscodeTheme ? true : false;
        const baseTheme = ignore ? 'vscode-light' : detectBaseTheme();
        return baseTheme !== 'vscode-light';
    }
}
