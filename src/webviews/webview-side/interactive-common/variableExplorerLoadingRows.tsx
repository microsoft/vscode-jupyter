// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import './variableExplorerEmptyRows.css'; // Use same CSS as variableExplorerEmptyRows.tsx

import * as React from 'react';
import { getLocString } from '../react-common/locReactSide';

export const VariableExplorerLoadingRowsView = () => {
    const message = getLocString('DataScience.loadingRowsInVariableExplorer', 'Loading variables');

    return <div id="variable-explorer-empty-rows">{message}</div>;
};
