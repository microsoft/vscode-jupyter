// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as React from 'react';

/* eslint-disable @typescript-eslint/no-explicit-any */
interface IVariableExplorerRowProps {
    renderBaseRow(props: any): JSX.Element;
}

export const VariableExplorerRowRenderer: React.SFC<IVariableExplorerRowProps & any> = (props) => {
    return <div role="row">{props.renderBaseRow(props)}</div>;
};
