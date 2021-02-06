// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import * as ReduxCommon from '../../interactive-common/redux/store';
import { PostOffice } from '../../react-common/postOffice';
import { reducerMap } from './reducers';
import { forceLoad } from '../../interactive-common/transforms';

// This special version uses the reducer map from the INativeEditorMapping
export function createStore(skipDefault: boolean, baseTheme: string, testMode: boolean, postOffice: PostOffice) {
    return ReduxCommon.createStore(
        skipDefault,
        baseTheme,
        testMode,
        true,
        true,
        false,
        reducerMap,
        postOffice,
        forceLoad
    );
}
