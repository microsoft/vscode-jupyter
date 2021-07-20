// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { measureText } from '../../react-common/textMeasure';
import '../globalJQueryImports';
import { ReactSlickGridFilterBox } from '../reactSlickGridFilterBox';
import { Resizable } from 're-resizable';

/*
WARNING: Do not change the order of these imports.
Slick grid MUST be imported after we load jQuery and other stuff from `./globalJQueryImports`
*/
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const slickgridJQ = require('slickgrid/lib/jquery-1.11.2.min');

// Adding comments to ensure order of imports does not change due to auto formatters.
// eslint-disable-next-line import/order
import 'slickgrid/slick.core';
// Adding comments to ensure order of imports does not change due to auto formatters.
// eslint-disable-next-line import/order
import 'slickgrid/slick.dataview';
// Adding comments to ensure order of imports does not change due to auto formatters.
// eslint-disable-next-line import/order
import 'slickgrid/slick.grid';
import 'slickgrid/slick.editors';
// Adding comments to ensure order of imports does not change due to auto formatters.
// eslint-disable-next-line import/order
import 'slickgrid/plugins/slick.autotooltips';
import 'slickgrid/plugins/slick.headerbuttons';
// Adding comments to ensure order of imports does not change due to auto formatters.
// eslint-disable-next-line import/order
import 'slickgrid/slick.grid.css';
// Make sure our css comes after the slick grid css. We override some of its styles.
// eslint-disable-next-line import/order
import './dataWranglerReactSlickGrid.css';
import './contextMenu.css';
import { ISlickGridProps, ISlickGridSlice, ISlickRow, ReactSlickGrid } from '../reactSlickGrid';
import {
    DataWranglerCommands,
    ICellCssStylesHash,
    IDescribeColReq,
    IDropDuplicatesRequest,
    IDropNaRequest,
    IDropRequest,
    INormalizeColumnRequest
} from '../../../client/datascience/data-viewing/data-wrangler/types';
import { ControlPanel } from './controlPanel';
import { IDataFrameInfo } from '../../../client/datascience/data-viewing/types';
import { getLocString } from '../../react-common/locReactSide';

/*
WARNING: Do not change the order of these imports.
Slick grid MUST be imported after we load jQuery and other stuff from `./globalJQueryImports`
*/

const RowContextMenuItem = {
    DropRow: getLocString('DataScience.dataWranglerDropRow', 'Drop Row'),
    DropRows: getLocString('DataScience.dataWranglerDropRows', 'Drop Rows'),
    CopyData: getLocString('DataScience.interactiveCopyCell', 'Copy Cell')
};

const ColumnContextMenuItem = {
    DropColumn: getLocString('DataScience.dataWranglerDropColumn', 'Drop Column'),
    DropColumns: getLocString('DataScience.dataWranglerDropColumns', 'Drop Columns'),
    NormalizeColumn: getLocString('DataScience.dataWranglerNormalizeColumn', 'Normalize Column'),
    DropNa: getLocString('DataScience.dataWranglerDropNa', 'Remove Missing Values'),
    DropDuplicatesOnColumn: getLocString('DataScience.dataWranglerDropDuplicatesOnColumn', 'Drop Duplicates On Column'),
    DropDuplicatesOnColumns: getLocString(
        'DataScience.dataWranglerDropDuplicatesOnColumns',
        'Drop Duplicates On Columns'
    )
};

const STYLING_OPERATIONS = [
    DataWranglerCommands.NormalizeColumn,
    DataWranglerCommands.DropNa,
    DataWranglerCommands.ReplaceAllColumn,
    DataWranglerCommands.FillNa,
    'Selected rows'
];
const PREVIEW_TITLE = '(preview)';
const INDEX_COLUMN_ID = '1';

export class DataWranglerReactSlickGrid extends ReactSlickGrid {
    private contextMenuRowId: number | undefined;
    private contextMenuCellId: number | undefined;
    private contextMenuColumnName: string | undefined;

    constructor(props: ISlickGridProps) {
        super(props);
        this.state = {
            fontSize: 12,
            showingFilters: false,
            selectedColumns: [],
            selectedRows: []
        };
        this.props.toggleFilterEvent?.subscribe(this.clickFilterButton);
        this.props.scrollColumnIntoViewEvent?.subscribe(this.scrollColumnIntoView);
    }

    // eslint-disable-next-line
    // This version is very similar to the one in data viewer's reactSlickGrid.tsx
    // but with some things added onto the grid
    public componentDidMount = () => {
        window.addEventListener('resize', this.windowResized);

        if (this.containerRef.current) {
            // Compute font size. Default to 12 if not found.
            let fontSize = parseInt(
                getComputedStyle(this.containerRef.current).getPropertyValue('--code-font-size'),
                10
            );
            if (isNaN(fontSize)) {
                fontSize = 12;
            }

            // Setup options for the grid
            const options: Slick.GridOptions<Slick.SlickData> = {
                asyncEditorLoading: true,
                editable: true,
                enableTextSelectionOnCells: true,
                enableCellNavigation: true,
                editorCellNavOnLRKeys: true,
                showHeaderRow: true,
                enableColumnReorder: false,
                explicitInitialization: false,
                viewportClass: 'react-grid',
                rowHeight: this.getAppropiateRowHeight(fontSize)
            };

            const columns = this.styleColumns(this.props.columns);

            // Create the grid
            const grid = new Slick.Grid<ISlickRow>(this.containerRef.current, this.dataView, columns, options);
            grid.registerPlugin(new Slick.AutoTooltips({ enableForCells: true, enableForHeaderCells: true }));
            grid.registerPlugin(new Slick.Plugins.HeaderButtons());
            // Setup our dataview
            this.dataView.beginUpdate();
            this.dataView.setFilter(this.filter.bind(this));
            this.dataView.setItems([], this.props.idProperty);
            this.dataView.endUpdate();

            this.dataView.onRowCountChanged.subscribe((_e, _args) => {
                grid.updateRowCount();
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                this.changeCellStylings(grid);
                grid.render();
                grid.setSortColumn(INDEX_COLUMN_ID, true);
                setSortGlyphs(grid);
            });

            this.dataView.onRowsChanged.subscribe((_e, args) => {
                grid.invalidateRows(args.rows);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                grid.render();
                grid.setSortColumn(INDEX_COLUMN_ID, true);
                setSortGlyphs(grid);
            });

            // Setup the filter render
            grid.onHeaderRowCellRendered.subscribe(this.renderFilterCell);

            grid.onHeaderCellRendered.subscribe((_e, args) => {
                // Add a tab index onto our header cell
                args.node.tabIndex = 0;
            });

            // Unbind the slickgrid key handler from the canvas code
            // We want to keep EnableCellNavigation on so that we can use the slickgrid
            // public navigations functions, but we don't want the slickgrid keyhander
            // to eat tab keys and prevent us from tabbing to input boxes or column headers
            const canvasElement = grid.getCanvasNode();
            slickgridJQ(canvasElement).off('keydown');

            if (this.containerRef && this.containerRef.current) {
                // slickgrid creates empty focus sink div elements that capture tab input we don't want that
                // so unhook their key handlers and remove their tabindex
                const firstFocus = slickgridJQ('.react-grid-container').children().first();
                const lastFocus = slickgridJQ('.react-grid-container').children().last();
                slickgridJQ(firstFocus).off('keydown').removeAttr('tabindex');
                slickgridJQ(lastFocus).off('keydown').removeAttr('tabindex');

                // Set our key handling on the actual grid viewport
                slickgridJQ('.react-grid')
                    .on('keydown', this.slickgridHandleKeyDown)
                    .attr('role', 'grid')
                    .on('focusin', this.slickgridFocus);
                slickgridJQ('.grid-canvas').on('keydown', this.slickgridHandleKeyDown);
            }

            grid.onHeaderContextMenu.subscribe(this.maybeDropColumns);
            grid.onContextMenu.subscribe(this.maybeDropRows);

            // For column and row selection
            grid.onHeaderClick.subscribe(this.selectColumn);
            grid.onClick.subscribe(this.selectRow);

            // Data row context menu
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            slickgridJQ('#contextMenu').click((e: any) => {
                if (
                    !slickgridJQ(e.target).is('li') ||
                    !this.state.grid?.getEditorLock().commitCurrentEdit() ||
                    this.contextMenuCellId === undefined ||
                    this.contextMenuRowId === undefined
                ) {
                    return;
                }
                const contextMenuItem = e.target.id;
                const columnName = this.props.columns[this.contextMenuCellId].field;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const cellData = (this.dataView.getItemById(this.contextMenuRowId) as any)[columnName!];
                switch (contextMenuItem) {
                    case RowContextMenuItem.DropRow:
                        if (this.props.submitCommand) {
                            this.props.submitCommand({
                                command: DataWranglerCommands.Drop,
                                args: { rowIndices: this.state.selectedRows } as IDropRequest
                            });
                            return this.resetSelections();
                        }
                        return;
                    case RowContextMenuItem.CopyData:
                        if (cellData === undefined) {
                            // This is when you try to copy the slickGrid built-in index
                            void navigator.clipboard.writeText(this.contextMenuCellId.toString());
                        } else {
                            void navigator.clipboard.writeText(cellData);
                        }
                        return;
                }
            });

            // Header row context menu
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            slickgridJQ('#headerContextMenu').click((e: any) => {
                if (!slickgridJQ(e?.currentTarget).is('ul') || !this.state.grid?.getEditorLock().commitCurrentEdit()) {
                    return;
                }
                const contextMenuItem = e?.target?.id;
                if (this.props.submitCommand) {
                    switch (contextMenuItem) {
                        case ColumnContextMenuItem.DropColumn:
                        case ColumnContextMenuItem.DropColumns:
                            this.props.submitCommand({
                                command: DataWranglerCommands.Drop,
                                args: { targetColumns: this.state.selectedColumns } as IDropRequest
                            });
                            return this.resetSelections();

                        case ColumnContextMenuItem.NormalizeColumn:
                            this.props.submitCommand({
                                command: DataWranglerCommands.NormalizeColumn,
                                args: {
                                    start: 0,
                                    end: 1,
                                    targetColumn: this.contextMenuColumnName,
                                    isPreview: true
                                } as INormalizeColumnRequest
                            });
                            return this.resetSelections();

                        case ColumnContextMenuItem.DropNa:
                            this.props.submitCommand({
                                command: DataWranglerCommands.DropNa,
                                args: {
                                    targetColumns: this.state.selectedColumns,
                                    isPreview: false
                                } as IDropNaRequest
                            });
                            return this.resetSelections();

                        case ColumnContextMenuItem.DropDuplicatesOnColumn:
                        case ColumnContextMenuItem.DropDuplicatesOnColumns:
                            this.props.submitCommand({
                                command: DataWranglerCommands.DropDuplicates,
                                args: { targetColumns: this.state.selectedColumns } as IDropDuplicatesRequest
                            });
                            return this.resetSelections();
                    }
                }
            });

            // Init to force the actual render.
            grid.init();

            // Set the initial sort column to our index column
            const indexColumn = columns.find((c) => c.field === this.props.idProperty);
            if (indexColumn && indexColumn.id) {
                grid.setSortColumn(indexColumn.id, true);
            }

            // Save in our state
            this.setState({ grid, fontSize });
        }

        // Act like a resize happened to refresh the layout.
        this.windowResized();
    };

    private changeCellStylings(grid: Slick.Grid<ISlickRow>) {
        this.removeAllCellStyles(grid);
        if (this.props.operationPreview && this.props.cssStylings) {
            grid.setCellCssStyles(this.props.operationPreview, this.props.cssStylings);
        }
    }

    private removeAllCellStyles(grid: Slick.Grid<ISlickRow>) {
        STYLING_OPERATIONS.forEach((key) => {
            grid.removeCellCssStyles(key);
        });
    }

    public render() {
        const style: React.CSSProperties = this.props.forceHeight
            ? {
                  height: `${this.props.forceHeight}px`,
                  width: `${this.props.forceHeight}px`
              }
            : {};

        return (
            <div className="outer-container">
                <div style={{ display: 'flex', width: '100%', height: '100%', overflow: 'hidden' }}>
                    <div className="react-grid-container" style={style} ref={this.containerRef}></div>
                    <div className="react-grid-measure" ref={this.measureRef} />
                    <Resizable
                        style={{
                            display: 'flex',
                            alignItems: 'top',
                            justifyContent: 'right',
                            flexDirection: 'column',
                            zIndex: 99998
                        }}
                        handleClasses={{ left: 'resizable-span resizable-span-vertical' }}
                        defaultSize={{ width: '40%', height: '95%' }}
                        onResize={() => {
                            this.props.resizeGridEvent.notify();
                        }}
                        enable={{
                            left: true,
                            top: false,
                            right: false,
                            bottom: false,
                            topRight: false,
                            bottomRight: false,
                            bottomLeft: false,
                            topLeft: false
                        }}
                    >
                        {/* Because we extend data viewer, we added data wrangler attributes into the data viewer
                        interface and made them optional so we have to use ?? here */}
                        <ControlPanel
                            historyList={this.props.historyList ?? []}
                            monacoThemeObj={this.props.monacoThemeObj}
                            histogramData={this.props.histogramData}
                            dataframeSummary={this.props.dataframeSummary ?? ({} as IDataFrameInfo)}
                            data={this.dataView.getItems()}
                            resizeEvent={this.props.resizeGridEvent}
                            headers={
                                this.state.grid
                                    ?.getColumns()
                                    .map((c) => c.field)
                                    .filter((c) => c !== undefined) as string[]
                            }
                            currentVariableName={this.props.currentVariableName ?? ''}
                            submitCommand={
                                this.props.submitCommand ??
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                ((_data: { command: string; args: any }) => {
                                    return;
                                })
                            }
                            sidePanels={this.props.sidePanels}
                            primarySelectedColumn={this.state.primarySelectedColumn}
                            selectedColumns={this.state.selectedColumns ?? []}
                            setSelectedColumns={this.setSelectedColumns.bind(this)}
                            setSelectedRows={this.setSelectedRows.bind(this)}
                        />
                    </Resizable>
                </div>
                <ul id="headerContextMenu" style={{ display: 'none', position: 'absolute' }}>
                    {this.state.selectedColumns && this.state.selectedColumns.length > 1 ? (
                        <>
                            <li id={ColumnContextMenuItem.DropColumns}>{ColumnContextMenuItem.DropColumns}</li>
                            <li id={ColumnContextMenuItem.DropNa}>{ColumnContextMenuItem.DropNa}</li>
                            <li id={ColumnContextMenuItem.DropDuplicatesOnColumn}>
                                {ColumnContextMenuItem.DropDuplicatesOnColumn}
                            </li>
                        </>
                    ) : (
                        <>
                            <li id={ColumnContextMenuItem.DropColumn}>{ColumnContextMenuItem.DropColumn}</li>
                            <li id={ColumnContextMenuItem.NormalizeColumn}>{ColumnContextMenuItem.NormalizeColumn}</li>
                            <li id={ColumnContextMenuItem.DropNa}>{ColumnContextMenuItem.DropNa}</li>
                            <li id={ColumnContextMenuItem.DropDuplicatesOnColumns}>
                                {ColumnContextMenuItem.DropDuplicatesOnColumns}
                            </li>
                        </>
                    )}
                </ul>
                <ul id="contextMenu" style={{ display: 'none', position: 'absolute' }}>
                    {this.state.selectedRows && this.state.selectedRows.length > 1 ? (
                        <>
                            <li id={RowContextMenuItem.DropRow}>{RowContextMenuItem.DropRows}</li>
                        </>
                    ) : (
                        <>
                            <li id={RowContextMenuItem.DropRow}>{RowContextMenuItem.DropRow}</li>
                            <li id={RowContextMenuItem.CopyData}>{RowContextMenuItem.CopyData}</li>
                        </>
                    )}
                </ul>
            </div>
        );
    }

    private sortColumnFromHeader(sortCol: string | undefined) {
        const { columnId: currentSortColId, sortAsc: currentSortAsc } = this.state.grid?.getSortColumns()[0] ?? {
            columnId: INDEX_COLUMN_ID,
            sortAsc: true
        };
        if (sortCol) {
            if (sortCol === currentSortColId) {
                this.sortColumn(sortCol, !(currentSortAsc ?? false));
            } else {
                this.sortColumn(sortCol, true);
            }
        }
    }

    private sortColumn(sortCol: string | undefined, sortAscending: boolean) {
        if (sortCol) {
            const cols = this.state.grid?.getColumns();
            if (cols) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                this.dataView.sort((l: any, r: any) => this.compareElements(l, r, cols[+sortCol]), sortAscending);

                // Because column.sortable is false, this function only italicizes the column text
                this.state.grid?.setSortColumn(sortCol?.toString(), sortAscending);

                setSortGlyphs(this.state.grid);
            }
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private maybeDropColumns = (e: any, data: Slick.OnHeaderContextMenuEventArgs<ISlickRow>) => {
        this.contextMenuColumnName = data.column.field;

        // Don't show context menu for the row numbering column or index column or preview columns
        if (
            data.column.id === '0' ||
            data.column.id === INDEX_COLUMN_ID ||
            data.column.field?.includes(PREVIEW_TITLE)
        ) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();

        // Also select on context menu (right click) events
        if (!this.state.selectedColumns?.includes(this.contextMenuColumnName!)) {
            this.setSelectedColumns([this.contextMenuColumnName!], this.contextMenuColumnName);
        }

        // Show our context menu
        slickgridJQ('#headerContextMenu').css('top', e.pageY).css('left', e.pageX).show();
        slickgridJQ('#contextMenu').hide();

        // If user clicks away from the context menu, hide it
        slickgridJQ('body').one('click', () => {
            slickgridJQ('#headerContextMenu').hide();
            this.contextMenuColumnName = undefined;
        });
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private maybeDropRows = (e: any) => {
        const cell = this.state.grid?.getCellFromEvent(e);
        if (!cell) {
            return;
        }

        // Also select on context menu (right click) events
        if (!this.state.selectedRows?.includes(cell.row)) {
            this.setSelectedRows([cell.row], cell.row);
        }

        this.contextMenuRowId = cell.row;
        this.contextMenuCellId = cell.cell;
        e.preventDefault();
        e.stopPropagation();
        // Show our context menu
        slickgridJQ('#contextMenu').css('top', e.pageY).css('left', e.pageX).show();

        // If user clicks away from the context menu, hide it
        slickgridJQ('body').one('click', () => {
            slickgridJQ('#contextMenu').hide();
            this.contextMenuRowId = undefined;
        });
    };

    /**
     * Header click handler, handles column selection
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private selectColumn = (e: any, data: Slick.OnHeaderClickEventArgs<ISlickRow>) => {
        const selectedColumnId = data.column.id;

        // Disallow selection for the row numbering column or index column or preview columns
        if (
            !selectedColumnId ||
            selectedColumnId === '0' ||
            selectedColumnId === INDEX_COLUMN_ID ||
            data.column.field?.includes(PREVIEW_TITLE)
        ) {
            return;
        }

        if (!this.state.grid) {
            return;
        }

        let selectedColumns: string[];
        let primarySelectedColumn;

        // Behaviour we want for primary selected column:
        // Show column A summary on a column A click
        // If multiselect more, continue to show column A summary
        // If deselect column A then show default summary view

        if (e.shiftKey && this.state.selectedColumns !== undefined && this.state.selectedColumns.length === 1) {
            // Handle shift click
            const columns = this.state.grid.getColumns() ?? [];

            // Find ID of first selected column
            const firstSelectedColumnName = this.state.selectedColumns[0] ?? '';
            const firstSelectedColumn = columns.find((c) => c.field! === firstSelectedColumnName);
            const firstColumnIndex = this.state.grid.getColumnIndex(firstSelectedColumn?.id!);

            const secondColumnIndex = this.state.grid.getColumnIndex(selectedColumnId);

            // Select all columns in between the two columns
            selectedColumns = columns
                .slice(Math.min(firstColumnIndex, secondColumnIndex), Math.max(firstColumnIndex, secondColumnIndex) + 1)
                .map((c) => c.field ?? '')
                .filter((name) => !name.includes(PREVIEW_TITLE));

            primarySelectedColumn = firstSelectedColumnName;
        } else if (e.ctrlKey) {
            // Handle ctrl click
            if (this.state.selectedColumns?.includes(data.column.field!)) {
                // Remove column from selection
                selectedColumns = this.state.selectedColumns?.filter((c) => c !== data.column.field);
                // If primarySelectedColumn was deselected, then set primarySelectedColumn to undefined
                primarySelectedColumn =
                    this.state.primarySelectedColumn === data.column.field
                        ? undefined
                        : this.state.primarySelectedColumn;
            } else {
                // Add column to selection
                selectedColumns = [...(this.state.selectedColumns ?? []), data.column.field!].sort();
                primarySelectedColumn = this.state.primarySelectedColumn ?? data.column.field;
            }
        } else {
            // Handle ordinary click
            if (this.state.primarySelectedColumn === data.column.field) {
                // Remove column from selection
                selectedColumns = [];
            } else {
                // Add column to selection
                selectedColumns = [data.column.field!];
            }
        }

        // also clear out the selected rows, as they probably shouldn't be displayed at the same time
        this.setSelectedRows([]);
        this.setSelectedColumns(selectedColumns, primarySelectedColumn);
    };

    /**
     * Updates the internal state to the currently selected columns
     */
    private setSelectedColumns(selectedColumns: string[], selectedColumn?: string) {
        const grid = this.state.grid;
        if (!grid) {
            return;
        }

        // If there's one column selected, it will always be the primary column
        const primarySelectedColumn = selectedColumns.length === 1 ? selectedColumns[0] : selectedColumn;

        // Tell summary panel which column summary to display
        this.props.submitCommand!({
            command: DataWranglerCommands.Describe,
            args: { targetColumn: primarySelectedColumn } as IDescribeColReq
        });

        this.setState(
            {
                selectedColumns,
                primarySelectedColumn
            },
            () => {
                // Style columns after state is set
                const columns = this.styleColumns(grid.getColumns());
                grid.setColumns(columns);
                this.updateCssStyles();
            }
        );
    }

    /**
     * Cell click handler, handles row selection
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private selectRow = (e: any, data: Slick.OnClickEventArgs<ISlickRow>) => {
        const selectedRowIndex = data.row;
        let selectedRows: number[];
        let primarySelectedRow;

        if (e.shiftKey && this.state.selectedRows?.length === 1) {
            // Handle shift click
            const firstRowIndex = this.state.selectedRows[0];
            const secondRowIndex = selectedRowIndex;
            const start = Math.min(firstRowIndex, secondRowIndex);
            const end = Math.max(firstRowIndex, secondRowIndex);
            selectedRows = new Array(end - start + 1).fill(0).map((_e, idx) => idx + start);
            primarySelectedRow = firstRowIndex;
        } else if (e.ctrlKey) {
            // Handle ctrl click
            if (this.state.selectedRows?.includes(selectedRowIndex)) {
                selectedRows = this.state.selectedRows?.filter((c) => c !== selectedRowIndex);
            } else {
                selectedRows = [...(this.state.selectedRows ?? []), selectedRowIndex].sort();
                primarySelectedRow = selectedRowIndex;
            }
        } else {
            if (this.state.primarySelectedRow === selectedRowIndex) {
                selectedRows = [];
            } else {
                selectedRows = [selectedRowIndex];
                primarySelectedRow = selectedRowIndex;
            }
        }

        // also clear out the selected cols, as they probably shouldn't be displayed at the same time
        this.setSelectedColumns([]);
        this.setSelectedRows(selectedRows, primarySelectedRow);
    };

    /**
     * Updates the internal state to the currently selected rows
     */
    private setSelectedRows(selectedRows: number[], primarySelectedRow?: number) {
        const grid = this.state.grid;
        if (!grid) {
            return;
        }
        this.setState(
            {
                selectedRows,
                primarySelectedRow
            },
            () => {
                // Style rows after state is set

                // force re-render for the styles to be applied
                let stylings: ICellCssStylesHash;
                const rowStyling: { [id: number]: string } = {};
                const columns = this.state.grid?.getColumns().length;
                // Create individual row styling that will be given to each row
                // It is an object with the keys as all the column names
                for (let i = 0; i < (columns ?? 0); i++) {
                    rowStyling[i] = 'react-grid-row-cell-selected';
                }
                // Create whole styling
                // It is an object with the keys as the rows and the values as the stylings defined above
                stylings =
                    selectedRows?.reduce((result, row) => {
                        result[row] = rowStyling;
                        return result;
                    }, {} as ICellCssStylesHash) ?? {};

                grid.setCellCssStyles('Selected rows', stylings);
            }
        );
    }

    protected autoResizeColumns() {
        if (this.state.grid) {
            const fontString = this.computeFont();
            const columns = this.state.grid.getColumns();
            const placeholder = '999999999999999';
            const maxFieldWidth = measureText(placeholder, fontString);
            const oldColumns = this.getBeforePreviewColumns(columns);

            columns.forEach((c) => {
                c.header = {
                    buttons: []
                };

                // First column (that has the filter button)
                if (c.field === this.props.idProperty) {
                    c.width = maxFieldWidth / 2;
                    c.name = '';
                    c.header.buttons.push({
                        cssClass: 'codicon codicon-filter codicon-button header-cell-button',
                        handler: this.clickFilterButton,
                        tooltip: this.state.showingFilters
                            ? getLocString('DataScience.dataViewerHideFilters', 'Hide filters')
                            : getLocString('DataScience.dataViewerShowFilters', 'Show filters')
                    });
                    return;
                }

                const {
                    columnId: currentSortColId,
                    sortAsc: currentSortAsc
                } = this.state.grid?.getSortColumns()[0] ?? { columnId: INDEX_COLUMN_ID, sortAsc: true };
                const sortGlyphClass =
                    currentSortColId === c.id && currentSortAsc ? 'codicon-arrow-down' : 'codicon-arrow-up';
                const sortTooltip =
                    currentSortColId === c.id && currentSortAsc
                        ? getLocString('Common.sortDesc', 'Sort Descending')
                        : getLocString('Common.sortAsc', 'Sort Ascending');

                c.width = maxFieldWidth;

                if (c.field?.includes(PREVIEW_TITLE)) {
                    // Preview column
                    c.name = `+ ${c.field}`;
                    c.header.buttons.push(
                        {
                            cssClass: 'codicon codicon-close codicon-button',
                            handler: () => {
                                this.respondToPreview(false);
                            },
                            tooltip: getLocString('DataScience.dataWranglerRejectStep', 'Reject Step')
                        },
                        {
                            cssClass: 'codicon codicon-check codicon-button',
                            handler: () => {
                                this.respondToPreview(true);
                            },
                            tooltip: getLocString('DataScience.dataWranglerAcceptStep', 'Accept Step')
                        },
                        {
                            cssClass: `codicon codicon-button show-on-hover-child codicon-sort ${sortGlyphClass}`,
                            handler: () => {
                                this.sortColumnFromHeader(c.id);
                            },
                            tooltip: sortTooltip
                        }
                    );
                } else {
                    // Regular column

                    // Original column that has been previewed
                    if (oldColumns.has(c.field)) {
                        c.name = `- ${c.field}`;
                    }

                    c.header.buttons.push({
                        cssClass: `codicon codicon-button show-on-hover-child codicon-sort ${sortGlyphClass}`,
                        handler: () => {
                            this.sortColumnFromHeader(c.id);
                        },
                        tooltip: sortTooltip
                    });
                }
            });
            this.state.grid.setColumns(columns);

            // We also need to update the styles as slickgrid will mess up the height of rows
            // again
            setTimeout(() => {
                this.updateCssStyles();
            }, 0);
        }
    }

    private respondToPreview(doesAccept: boolean) {
        if (this.props.submitCommand) {
            this.props.submitCommand({
                command: DataWranglerCommands.RespondToPreview,
                args: {
                    doesAccept
                }
            });
        }
    }

    protected setColumns = (newColumns: Slick.Column<Slick.SlickData>[]) => {
        this.state.grid?.setColumns(newColumns);
        this.autoResizeColumns();
    };

    protected resetGrid = (_e: Slick.EventData, data: ISlickGridSlice) => {
        this.dataView.setItems([]);
        const styledColumns = this.styleColumns(data.columns);
        this.setColumns(styledColumns);
        this.setSelectedRows([]);
    };

    protected renderFilterCell = (
        _e: Slick.EventData,
        args: Slick.OnHeaderRowCellRenderedEventArgs<Slick.SlickData>
    ) => {
        const oldColumns = this.getBeforePreviewColumns(this.state.grid?.getColumns() ?? []);
        if (args.column.field === this.props.idProperty) {
            const tooltipText = getLocString('DataScience.clearFilters', 'Clear all filters');
            ReactDOM.render(
                <div
                    className="codicon codicon-clear-all codicon-button"
                    onClick={this.clearAllFilters}
                    title={tooltipText}
                />,
                args.node
            );
        } else {
            const filter = args.column.field ? this.columnFilters.get(args.column.field)?.text : '';
            ReactDOM.render(
                <ReactSlickGridFilterBox
                    filter={filter ?? ''}
                    column={args.column}
                    onChange={this.filterChanged}
                    fontSize={this.state.fontSize}
                />,
                args.node
            );

            // Style background of filter depending on state of columns
            const isSelectedColumn = this.state.selectedColumns?.includes(args.column.field!);
            if (isSelectedColumn) {
                args.node.classList.add('react-grid-header-cell-selected');
            } else if (args.column.isPreview) {
                args.node.classList.add('react-grid-header-cell-preview');
            } else if (oldColumns.has(args.column.field)) {
                args.node.classList.add('react-grid-header-cell-before');
            }
        }
    };

    protected styleColumns(columns: Slick.Column<ISlickRow>[]) {
        // Transform columns so they are sortable and stylable
        const oldColumns = this.getBeforePreviewColumns(columns);
        return columns.map((c) => {
            // Disable because clicking header makes it sort still so we have to implement our own glyph
            c.sortable = false;
            c.headerCssClass = 'show-on-hover-parent react-grid-header-cell';
            c.cssClass = 'react-grid-cell';

            const isSelectedColumn = this.state.selectedColumns?.includes(c.field!);
            if (isSelectedColumn) {
                c.headerCssClass += ' react-grid-header-cell-selected';
                c.cssClass += ' react-grid-cell-selected';
            } else if (c.isPreview) {
                c.headerCssClass += ' react-grid-header-cell-preview';
                c.cssClass += ' react-grid-cell-preview';
            } else if (oldColumns.has(c.field)) {
                c.headerCssClass += ' react-grid-header-cell-before';
                c.cssClass += ' react-grid-cell-before';
            }
            return c;
        });
    }

    private scrollColumnIntoView = (_e: Slick.EventData, column: string) => {
        const cell = this.state.grid?.getActiveCell();
        const columnIdx = this.state.grid?.getColumns().findIndex((c) => c.field === column);
        this.state.grid?.scrollCellIntoView(cell?.row || 0, columnIdx || 0, false);
    };

    private getBeforePreviewColumns(columns: Slick.Column<ISlickRow>[]) {
        const previewTitle = ` ${PREVIEW_TITLE}`;
        const previewColumns = columns.filter((c) => c.isPreview).map((c) => c.field);
        const oldColumns = previewColumns?.map((field) => field?.substring(0, field.length - previewTitle.length));
        return new Set(oldColumns);
    }

    private resetSelections() {
        this.setSelectedRows([]);
        this.setSelectedColumns([]);
    }
}

function setSortGlyphs(grid: Slick.Grid<ISlickRow> | undefined) {
    const { columnId: currentSortColId, sortAsc: currentSortAsc } = grid?.getSortColumns()[0] ?? {
        columnId: INDEX_COLUMN_ID,
        sortAsc: true
    };

    // Reset all columns to have arrow up
    slickgridJQ('.slick-header-columns')
        .children()
        .find('.codicon-sort')
        .removeClass('codicon-arrow-up codicon-arrow-down')
        .addClass('codicon-arrow-up');

    // Give sortColumn correct arrow direction
    slickgridJQ('.slick-header-columns')
        .children()
        .eq(+currentSortColId)
        .find('.codicon-sort')
        .removeClass('codicon-arrow-up codicon-arrow-down')
        .addClass(currentSortAsc ? 'codicon-arrow-down' : 'codicon-arrow-up');
}
