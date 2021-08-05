// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { IJupyterExtraSettings } from '../../../../client/datascience/types';
import { detectBaseTheme } from '../../../react-common/themeDetector';

export namespace Helpers {
    export function computeKnownDark(settings?: IJupyterExtraSettings): boolean {
        const ignore = settings?.ignoreVscodeTheme ? true : false;
        const baseTheme = ignore ? 'vscode-light' : detectBaseTheme();
        return baseTheme !== 'vscode-light';
    }
}
