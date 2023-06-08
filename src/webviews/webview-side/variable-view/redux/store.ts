// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as ReduxCommon from '../../interactive-common/redux/store';
import { PostOffice } from '../../react-common/postOffice';
import { reducerMap } from './reducers';

// Create a redux store using the reducerMap from VariableViewPanel
export function createStore(skipDefault: boolean, baseTheme: string, testMode: boolean, postOffice: PostOffice) {
    return ReduxCommon.createStore(
        skipDefault,
        baseTheme,
        testMode,
        false,
        false,
        true /* Start with variable view open */,
        reducerMap,
        postOffice,
        () => Promise.resolve()
    );
}
