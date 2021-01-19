// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import * as React from 'react';

import { IJupyterVariable } from '../../client/datascience/types';
import { VariableExplorer } from './variableExplorer';

export interface IVariablePanelProps {
    baseTheme: string;
    busy: boolean;
    skipDefault?: boolean;
    testMode?: boolean;
    variables: IJupyterVariable[];
    executionCount: number;
    refreshCount: number;
    debugging: boolean;
    fontSize: number;
    offsetHeight: number;
    gridHeight: number;
    containerHeight: number;
    showDataExplorer(targetVariable: IJupyterVariable, numberOfColumns: number): void;
    closeVariableExplorer(): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setVariableExplorerHeight(containerHeight: number, gridHeight: number): any;
    pageIn(startIndex: number, pageSize: number): void;
}

export class VariablePanel extends React.Component<IVariablePanelProps> {
    constructor(prop: IVariablePanelProps) {
        super(prop);
    }

    public render() {
        return (
            <VariableExplorer
                gridHeight={this.props.gridHeight}
                containerHeight={this.props.containerHeight}
                offsetHeight={this.props.offsetHeight}
                fontSize={this.props.fontSize}
                variables={this.props.variables}
                debugging={this.props.debugging}
                baseTheme={this.props.baseTheme}
                skipDefault={this.props.skipDefault}
                showDataExplorer={this.props.showDataExplorer}
                closeVariableExplorer={this.props.closeVariableExplorer}
                setVariableExplorerHeight={this.props.setVariableExplorerHeight}
                pageIn={this.props.pageIn}
                executionCount={this.props.executionCount}
                refreshCount={this.props.refreshCount}
            />
        );
    }
}
