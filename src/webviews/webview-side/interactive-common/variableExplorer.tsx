// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import './variableExplorer.css';

import fastDeepEqual from 'fast-deep-equal';
import * as React from 'react';

import { getLocString } from '../react-common/locReactSide';
import { IButtonCellValue, VariableExplorerButtonCellFormatter } from './variableExplorerButtonCellFormatter';
import { CellStyle, VariableExplorerCellFormatter } from './variableExplorerCellFormatter';
import { VariableExplorerEmptyRowsView } from './variableExplorerEmptyRows';

import AdazzleReactDataGrid from 'react-data-grid';
import { VariableExplorerHeaderCellFormatter } from './variableExplorerHeaderCellFormatter';
import { VariableExplorerRowRenderer } from './variableExplorerRowRenderer';

import { IVariableState } from './redux/reducers/variables';
import './variableExplorerGrid.less';
import { VariableExplorerLoadingRowsView } from './variableExplorerLoadingRows';
import { IJupyterVariable } from '../../../kernels/variables/types';
import { RegExpValues } from '../../../platform/common/constants';

interface IVariableExplorerProps {
    baseTheme: string;
    skipDefault?: boolean;
    variables: IJupyterVariable[];
    debugging: boolean;
    fontSize: number;
    executionCount: number;
    refreshCount: number;
    offsetHeight: number;
    gridHeight: number;
    containerHeight: number;
    showDataExplorer(targetVariable: IJupyterVariable, numberOfColumns: number): void;
    closeVariableExplorer(): void;
    setVariableExplorerHeight(containerHeight: number, gridHeight: number): void;
    pageIn(startIndex: number, pageSize: number): void;
    sort(sortColumn: string, sortAscending: boolean): void;
    viewHeight: number;
    requestInProgress: boolean;
    isWeb: boolean;
}

const defaultColumnProperties = {
    filterable: false,
    sortable: false,
    resizable: true
};

interface IFormatterArgs {
    isScrolling?: boolean;
    value?: string | number | object | boolean;
    row?: IGridRow;
}

interface IGridRow {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    name: string;
    type: string;
    size: string;
    value: string | undefined;
    index: number;
    buttons: IButtonCellValue;
}

interface IVariableExplorerState {
    containerHeight: number;
    gridHeight: number;
    isWeb: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export class VariableExplorer extends React.Component<IVariableExplorerProps, IVariableExplorerState> {
    private variableExplorerRef: React.RefObject<HTMLDivElement>;
    private variableExplorerMenuBarRef: React.RefObject<HTMLDivElement>;
    private variablePanelRef: React.RefObject<HTMLDivElement>;

    private pageSize: number = -1;

    // These values keep track of variable requests so we don't make the same ones over and over again
    // Note: This isn't in the redux state because the requests will come before the state
    // has been updated. We don't want to force a wait for redraw to determine if a request
    // has been sent or not.
    private requestedPages: number[] = [];
    private requestedPagesExecutionCount: number = 0;
    private requestedRefreshCount: number = 0;
    private gridColumns: {
        key: string;
        name: string;
        type: string;
        width: number;
        formatter: any;
        headerRenderer?: JSX.Element;
        sortable?: boolean;
        resizable?: boolean;
    }[];

    constructor(prop: IVariableExplorerProps) {
        super(prop);

        this.state = {
            containerHeight: this.props.containerHeight,
            gridHeight: this.props.gridHeight,
            isWeb: this.props.isWeb
        };

        this.handleResizeMouseMove = this.handleResizeMouseMove.bind(this);
        this.setInitialHeight = this.setInitialHeight.bind(this);
        this.saveCurrentSize = this.saveCurrentSize.bind(this);
        this.sortRows = this.sortRows.bind(this);

        this.gridColumns = [
            {
                key: 'buttons',
                name: '',
                type: 'boolean',
                width: 36,
                sortable: false,
                resizable: false,
                formatter: (
                    <VariableExplorerButtonCellFormatter
                        showDataExplorer={this.props.showDataExplorer}
                        baseTheme={this.props.baseTheme}
                    />
                )
            },
            {
                key: 'name',
                name: getLocString('DataScience.variableExplorerNameColumn', 'Name'),
                type: 'string',
                width: 120,
                sortable: true,
                formatter: this.formatNameColumn,
                headerRenderer: <VariableExplorerHeaderCellFormatter />
            },
            {
                key: 'type',
                name: getLocString('DataScience.variableExplorerTypeColumn', 'Type'),
                type: 'string',
                width: 120,
                sortable: true,
                formatter: <VariableExplorerCellFormatter cellStyle={CellStyle.string} />,
                headerRenderer: <VariableExplorerHeaderCellFormatter />
            },
            {
                key: 'size',
                name: getLocString('DataScience.variableExplorerCountColumn', 'Size'),
                type: 'string',
                width: 120,
                formatter: <VariableExplorerCellFormatter cellStyle={CellStyle.numeric} />,
                headerRenderer: <VariableExplorerHeaderCellFormatter />
            },
            {
                key: 'value',
                name: getLocString('DataScience.variableExplorerValueColumn', 'Value'),
                type: 'string',
                width: 300,
                formatter: <VariableExplorerCellFormatter cellStyle={CellStyle.string} />,
                headerRenderer: <VariableExplorerHeaderCellFormatter />
            }
        ];

        this.variableExplorerRef = React.createRef<HTMLDivElement>();
        this.variablePanelRef = React.createRef<HTMLDivElement>();
        this.variableExplorerMenuBarRef = React.createRef<HTMLDivElement>();
    }

    public override componentDidMount() {
        if (this.state.containerHeight === 0) {
            this.setInitialHeight();
        }
    }

    public override shouldComponentUpdate(nextProps: IVariableExplorerProps, prevState: IVariableState): boolean {
        if (this.props.fontSize !== nextProps.fontSize) {
            // Size has changed, recompute page size
            this.pageSize = -1;
            return true;
        }
        if (!fastDeepEqual(this.props.variables, nextProps.variables)) {
            return true;
        }
        if (prevState.containerHeight !== this.state.containerHeight) {
            return true;
        }
        if (prevState.requestInProgress !== nextProps.requestInProgress) {
            return true;
        }

        // We need to update when height changes
        if (prevState.viewHeight !== nextProps.viewHeight) {
            return true;
        }

        if (prevState.isWeb !== nextProps.isWeb) {
            return true;
        }

        return false;
    }

    public override render() {
        const contentClassName = `variable-explorer-content`;
        let variableExplorerStyles: React.CSSProperties = { fontSize: `${this.props.fontSize.toString()}px` };
        if (this.props.viewHeight !== 0) {
            variableExplorerStyles = { ...variableExplorerStyles, height: this.props.viewHeight };
        }
        return (
            <div id="variable-panel" ref={this.variablePanelRef}>
                <div id="variable-panel-padding">
                    <div className="variable-explorer" ref={this.variableExplorerRef} style={variableExplorerStyles}>
                        <div className="variable-explorer-menu-bar" ref={this.variableExplorerMenuBarRef}>
                            <label className="inputLabel variable-explorer-label">
                                {getLocString('DataScience.collapseVariableExplorerLabel', 'Variables')}
                            </label>
                        </div>
                        <div className={contentClassName}>{this.renderGrid()}</div>
                    </div>
                </div>
            </div>
        );
    }

    private renderGrid() {
        const newGridHeight = this.calculateGridHeight(this.props.viewHeight);

        // Customize our empty rows views based on if we are in the act of requesting variables
        // Allows us to say "Loading" initially versus "No Variables Defined"
        // We have to handle this with two different React components as the grid emptyRowsView takes a component
        // not an element as a property and internally calls createElement without properties for the view
        const emptyRowsView = this.props.requestInProgress
            ? VariableExplorerLoadingRowsView
            : VariableExplorerEmptyRowsView;

        return (
            <div
                id="variable-explorer-data-grid"
                role="table"
                aria-label={getLocString('DataScience.collapseVariableExplorerLabel', 'Variables')}
            >
                <AdazzleReactDataGrid
                    columns={this.gridColumns.map((c) => {
                        return { ...defaultColumnProperties, ...c };
                    })}
                    // eslint-disable-next-line
                    rowGetter={this.getRow}
                    rowsCount={this.props.variables.length}
                    minHeight={newGridHeight || this.state.gridHeight}
                    headerRowHeight={this.getRowHeight()}
                    rowHeight={this.getRowHeight()}
                    onRowDoubleClick={this.rowDoubleClick}
                    emptyRowsView={emptyRowsView}
                    rowRenderer={VariableExplorerRowRenderer}
                    onGridSort={this.sortRows}
                    sortColumn="name"
                    sortDirection="ASC"
                />
            </div>
        );
    }

    private saveCurrentSize() {
        this.props.setVariableExplorerHeight(this.state.containerHeight, this.state.gridHeight);
    }

    private getRowHeight() {
        return this.props.fontSize + 11;
    }

    private setInitialHeight() {
        const variablePanel = this.variablePanelRef.current;
        if (!variablePanel) {
            return;
        }
        this.setState({
            containerHeight: variablePanel.offsetHeight
        });
    }

    private handleResizeMouseMove(e: any) {
        this.setVariableExplorerHeight(e);
        this.setVariableGridHeight();
    }

    private setVariableExplorerHeight(e: MouseEvent) {
        const variableExplorerMenuBar = this.variableExplorerMenuBarRef.current;
        const variablePanel = this.variablePanelRef.current;
        const variableExplorer = this.variableExplorerRef.current;

        if (!variableExplorerMenuBar || !variablePanel || !variableExplorer) {
            return;
        }

        const relY = e.pageY - variableExplorer.clientTop;
        const addHeight = relY - variablePanel.offsetHeight - this.props.offsetHeight;
        const updatedHeight = this.state.containerHeight + addHeight;

        // min height is one row of visible data
        const minHeight = this.getRowHeight() * 2 + variableExplorerMenuBar.clientHeight;
        const maxHeight = document.body.scrollHeight - this.props.offsetHeight - variableExplorerMenuBar.clientHeight;

        if (updatedHeight >= minHeight && updatedHeight <= maxHeight) {
            this.setState({
                containerHeight: updatedHeight
            });
        }
    }

    private calculateGridHeight(baseHeight: number): number {
        const variableExplorerMenuBar = this.variableExplorerMenuBarRef.current;

        if (!variableExplorerMenuBar) {
            return baseHeight;
        }

        // Subtract another 10px to take into acount the 5px margin in .variable-explorer
        // src\webviews/webview-side\interactive-common\variableExplorer.css
        return baseHeight - variableExplorerMenuBar.clientHeight - 10;
    }

    private setVariableGridHeight() {
        if (!this.variableExplorerMenuBarRef.current) {
            return;
        }

        this.setState({
            gridHeight: this.calculateGridHeight(this.state.containerHeight)
        });
    }

    private formatNameColumn = (args: IFormatterArgs): JSX.Element => {
        if (!args.isScrolling && args.row !== undefined && !args.value) {
            this.ensureLoaded(args.row.index);
        }

        return <VariableExplorerCellFormatter value={args.value} role={'cell'} cellStyle={CellStyle.variable} />;
    };

    private getRow = (index: number): IGridRow => {
        if (index >= 0 && index < this.props.variables.length) {
            const variable = this.props.variables[index];
            if (variable && variable.value) {
                let newSize = '';
                if (variable.shape && variable.shape !== '') {
                    newSize = variable.shape;
                } else if (variable.count) {
                    newSize = variable.count.toString();
                }
                let value = variable.value;
                if (variable.type === 'str' && variable.value) {
                    value = `'${variable.value}'`;
                }
                return {
                    buttons: {
                        name: variable.name,
                        supportsDataExplorer: variable.supportsDataExplorer,
                        variable,
                        numberOfColumns: this.getColumnCountFromShape(variable.shape)
                    },
                    name: variable.name,
                    type: variable.type,
                    size: newSize,
                    index,
                    value: value ? value : getLocString('DataScience.variableLoadingValue', 'Loading...')
                };
            }
        }

        return {
            buttons: { supportsDataExplorer: false, name: '', numberOfColumns: 0, variable: undefined },
            name: '',
            type: '',
            size: '',
            index,
            value: getLocString('DataScience.variableLoadingValue', 'Loading...')
        };
    };

    private computePageSize(): number {
        if (this.pageSize === -1) {
            // Based on font size and height of the main div
            if (this.variableExplorerRef.current) {
                this.pageSize = Math.max(
                    16,
                    Math.round(this.variableExplorerRef.current.offsetHeight / this.props.fontSize)
                );
            } else {
                this.pageSize = 50;
            }
        }
        return this.pageSize;
    }

    private ensureLoaded = (index: number) => {
        // Figure out how many items in a page
        const pageSize = this.computePageSize();

        // Skip if already pending or already have a value
        const haveValue = this.props.variables[index]?.value;
        const newExecution =
            this.props.executionCount !== this.requestedPagesExecutionCount ||
            this.props.refreshCount !== this.requestedRefreshCount;
        // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
        const notRequested = !this.requestedPages.find((n) => n <= index && index < n + pageSize);
        if (!haveValue && (newExecution || notRequested)) {
            // Try to find a page of data around this index.
            let pageIndex = index;
            while (
                pageIndex >= 0 &&
                pageIndex > index - pageSize / 2 &&
                (!this.props.variables[pageIndex] || !this.props.variables[pageIndex].value)
            ) {
                pageIndex -= 1;
            }

            // Clear out requested pages if new requested execution
            if (
                this.requestedPagesExecutionCount !== this.props.executionCount ||
                this.requestedRefreshCount !== this.props.refreshCount
            ) {
                this.requestedPages = [];
            }

            // Save in the list of requested pages
            this.requestedPages.push(pageIndex + 1);

            // Save the execution count for this request so we can verify we can skip it on next request.
            this.requestedPagesExecutionCount = this.props.executionCount;
            this.requestedRefreshCount = this.props.refreshCount;

            // Load this page.
            this.props.pageIn(pageIndex + 1, pageSize);
        }
    };

    private getColumnCountFromShape(shape: string | undefined): number {
        if (shape) {
            // Try to match on the second value if there is one
            const matches = RegExpValues.ShapeSplitterRegEx.exec(shape);
            if (matches && matches.length > 1) {
                return parseInt(matches[1], 10);
            }
        }
        return 0;
    }

    private rowDoubleClick = (_rowIndex: number, row: IGridRow) => {
        // On row double click, see if data explorer is supported and open it if it is
        if (
            row.buttons &&
            row.buttons.supportsDataExplorer !== undefined &&
            row.buttons.name &&
            row.buttons.supportsDataExplorer &&
            row.buttons.variable
        ) {
            this.props.showDataExplorer(row.buttons.variable, row.buttons.numberOfColumns);
        }
    };

    private sortRows(sortColumn: string, sortDirection: 'ASC' | 'DESC' | 'NONE') {
        const sortAscending = sortDirection === 'ASC';
        if (sortDirection === 'NONE') {
            this.props.sort('name', true);
        } else {
            this.props.sort(sortColumn, sortAscending);
        }
    }
}
