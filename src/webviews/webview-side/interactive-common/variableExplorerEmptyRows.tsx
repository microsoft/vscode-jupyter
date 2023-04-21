// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import './variableExplorerEmptyRows.css';

import * as React from 'react';
import { getLocString } from '../react-common/locReactSide';

export const VariableExplorerEmptyRowsView = () => {
    const message = getLocString('noRowsInVariableExplorer', 'No variables defined');

    return <div id="variable-explorer-empty-rows">{message}</div>;
};
