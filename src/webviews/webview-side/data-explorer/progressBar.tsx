// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import './progressBar.css';

import * as React from 'react';
import { getLocString } from '../react-common/locReactSide';

export interface IEmptyRowsProps {
    total: number;
    current: number;
}

export const ProgressBar = (props: IEmptyRowsProps) => {
    const percent = (props.current / props.total) * 100;
    const percentText = `${Math.round(percent)}%`;
    const style: React.CSSProperties = {
        width: percentText
    };
    const message = getLocString('fetchingDataViewer', 'Fetching data ...');

    return (
        <div className="progress-container">
            {message}
            <div className="progress-bar" style={style}>
                {percentText}
            </div>
        </div>
    );
};
