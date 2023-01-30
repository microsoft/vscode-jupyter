// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import './emptyRowsView.css';

import * as React from 'react';
import { getLocString } from '../react-common/locReactSide';

export interface IEmptyRowsProps {}

export const EmptyRows = (_props: IEmptyRowsProps) => {
    const message = getLocString('noRowsInDataViewer', 'No rows match current filter');

    return <div className="container">{message}</div>;
};
