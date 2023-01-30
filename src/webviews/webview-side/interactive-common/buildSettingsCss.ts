// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IJupyterExtraSettings } from '../../../platform/webviews/types';

// From a set of data science settings build up any settings that need to be
// inserted into our StyleSetter divs some things like pseudo elements
// can't be put into inline styles
export function buildSettingsCss(settings: IJupyterExtraSettings | undefined): string {
    return settings
        ? `#main-panel-content::-webkit-scrollbar {
    width: ${settings.extraSettings.editor.verticalScrollbarSize}px;
}

.cell-output::-webkit-scrollbar {
    height: ${settings.extraSettings.editor.horizontalScrollbarSize}px;
}

.cell-output > *::-webkit-scrollbar {
    width: ${settings.extraSettings.editor.verticalScrollbarSize}px;
}`
        : '';
}
