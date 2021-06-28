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
import { ISlickGridProps, ISlickRow, ReactSlickGrid, readonlyCellEditor } from '../reactSlickGrid';
import {
    DataWranglerCommands,
    IDescribeColReq,
    IDropDuplicatesRequest,
    IDropNaRequest,
    IDropRequest,
    INormalizeColumnRequest
} from '../../../client/datascience/data-viewing/data-wrangler/types';
import { ControlPanel } from './controlPanel';
import { IGetColsResponse } from '../../../client/datascience/data-viewing/types';

/*
WARNING: Do not change the order of these imports.
Slick grid MUST be imported after we load jQuery and other stuff from `./globalJQueryImports`
*/

enum RowContextMenuItem {
    DropRow = 'Drop Row',
    CopyData = 'Copy Cell Data'
}

enum ColumnContextMenuItem {
    GetColumnStats = 'Get Column Stats',
    DropColumns = 'Drop Column',
    NormalizeColumn = 'Normalize Column',
    DropNA = 'Remove Missing Values',
    DropDuplicates = 'Drop Duplicates On Column',
    SortAscending = 'Sort Ascending',
    SortDescending = 'Sort Descending'
}

export class DataWranglerReactSlickGrid extends ReactSlickGrid {
    private contextMenuRowId: number | undefined;
    private contextMenuCellId: number | undefined;
    private contextMenuColumnName: string | undefined;

    constructor(props: ISlickGridProps) {
        super(props);
        this.state = { fontSize: 15, showingFilters: true };
        if (this.props.toggleFilterEvent) {
            this.props.toggleFilterEvent.subscribe(this.clickFilterButton);
        }
    }

    // eslint-disable-next-line
    // This version is very similar to the one in data viewer's reactSlickGrid.tsx
    // but with some things added onto the grid
    public componentDidMount = () => {
        window.addEventListener('resize', this.windowResized);

        if (this.containerRef.current) {
            // Compute font size. Default to 15 if not found.
            let fontSize = parseInt(
                getComputedStyle(this.containerRef.current).getPropertyValue('--code-font-size'),
                10
            );
            if (isNaN(fontSize)) {
                fontSize = 15;
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
                if (grid.getDataLength() === 0) {
                    const canvasElement = grid.getCanvasNode();
                    canvasElement.innerHTML = '<div class="no-data"><span>No data</span></div>';
                }
                grid.render();
            });

            this.dataView.onRowsChanged.subscribe((_e, args) => {
                grid.invalidateRows(args.rows);
                grid.render();
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
                const columnName = this.props.columns[this.contextMenuCellId].name;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const cellData = (this.dataView.getItemById(this.contextMenuRowId) as any)[columnName!];
                switch (contextMenuItem) {
                    case RowContextMenuItem.DropRow:
                        if (this.props.submitCommand) {
                            return this.props.submitCommand({
                                command: DataWranglerCommands.Drop,
                                args: { rowIndex: this.contextMenuRowId, mode: 'row' } as IDropRequest
                            });
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
                        case ColumnContextMenuItem.SortAscending:
                            return this.sortColumn(this.contextMenuColumnName, true);
                        case ColumnContextMenuItem.SortDescending:
                            return this.sortColumn(this.contextMenuColumnName, false);
                        case ColumnContextMenuItem.GetColumnStats:
                            return this.props.submitCommand({
                                command: DataWranglerCommands.Describe,
                                args: { targetColumn: this.contextMenuColumnName } as IDescribeColReq
                            });
                        case ColumnContextMenuItem.DropColumns:
                            return this.props.submitCommand({
                                command: DataWranglerCommands.Drop,
                                args: { targetColumns: [this.contextMenuColumnName] } as IDropRequest
                            });
                        case ColumnContextMenuItem.NormalizeColumn:
                            return this.props.submitCommand({
                                command: DataWranglerCommands.NormalizeColumn,
                                args: {
                                    start: 0,
                                    end: 1,
                                    targetColumn: this.contextMenuColumnName
                                } as INormalizeColumnRequest
                            });
                        case ColumnContextMenuItem.DropNA:
                            return this.props.submitCommand({
                                command: DataWranglerCommands.DropNa,
                                args: { targetColumns: [this.contextMenuColumnName] } as IDropNaRequest
                            });
                        case ColumnContextMenuItem.DropDuplicates:
                            return this.props.submitCommand({
                                command: DataWranglerCommands.DropDuplicates,
                                args: { targetColumns: [this.contextMenuColumnName] } as IDropDuplicatesRequest
                            });
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
                        handleClasses={{ left: 'resizable-span' }}
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
                            monacoTheme={this.props.monacoTheme ?? ''}
                            histogramData={this.props.histogramData ?? ({} as IGetColsResponse)}
                            data={this.dataView.getItems()}
                            resizeEvent={this.props.resizeGridEvent}
                            headers={
                                this.state.grid
                                    ?.getColumns()
                                    .map((c) => c.name)
                                    .filter((c) => c !== undefined) as string[]
                            }
                            currentVariableName={this.props.currentVariableName ?? ''}
                            /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-function */
                            submitCommand={this.props.submitCommand ?? ((_data: { command: string; args: any }) => {})}
                            /* eslint-enable no-return-assign, no-param-reassign */
                        />
                    </Resizable>
                </div>
                <ul id="headerContextMenu" style={{ display: 'none', position: 'absolute' }}>
                    {/* <li id={ColumnContextMenuItem.GetColumnStats}>{ColumnContextMenuItem.GetColumnStats}</li> */}
                    <li id={ColumnContextMenuItem.SortAscending}>{ColumnContextMenuItem.SortAscending}</li>
                    <li id={ColumnContextMenuItem.SortDescending}>{ColumnContextMenuItem.SortDescending}</li>
                    <li id={ColumnContextMenuItem.DropColumns}>{ColumnContextMenuItem.DropColumns}</li>
                    <li id={ColumnContextMenuItem.NormalizeColumn}>{ColumnContextMenuItem.NormalizeColumn}</li>
                    <li id={ColumnContextMenuItem.DropNA}>{ColumnContextMenuItem.DropNA}</li>
                    <li id={ColumnContextMenuItem.DropDuplicates}>{ColumnContextMenuItem.DropDuplicates}</li>
                </ul>
                <ul id="contextMenu" style={{ display: 'none', position: 'absolute' }}>
                    <li id={RowContextMenuItem.DropRow}>{RowContextMenuItem.DropRow}</li>
                    <li id={RowContextMenuItem.CopyData}>{RowContextMenuItem.CopyData}</li>
                </ul>
            </div>
        );
    }

    private sortColumn(sortCol: string | undefined, sortAscending: boolean) {
        if (sortCol) {
            const cols = this.state.grid?.getColumns();
            const idx = cols?.findIndex(c => c.name === sortCol);
            if (cols && idx) {
                this.dataView.sort((l: any, r: any) => this.compareElements(l, r, cols[idx]), sortAscending);
                this.state.grid?.setSortColumn(idx?.toString(), sortAscending);
            }
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private maybeDropColumns = (e: any, data: Slick.OnHeaderContextMenuEventArgs<ISlickRow>) => {
        this.contextMenuColumnName = data.column.name;
        // Don't show context menu for the row numbering column or index column
        if (data.column.field === 'No.' || data.column.field === 'index') {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        // Show our context menu
        slickgridJQ('#headerContextMenu').css('top', e.pageY).css('left', e.pageX).show();

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

    protected autoResizeColumns() {
        if (this.state.grid) {
            const fontString = this.computeFont();
            const columns = this.state.grid.getColumns();
            const placeholder = '99999999999';
            const maxFieldWidth = measureText(placeholder, fontString);
            columns.forEach((c) => {
                if (c.field !== this.props.idProperty) {
                    c.width = maxFieldWidth;
                } else {
                    c.width = maxFieldWidth / 2;
                    c.name = '';
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

    protected renderFilterCell = (
        _e: Slick.EventData,
        args: Slick.OnHeaderRowCellRenderedEventArgs<Slick.SlickData>
    ) => {
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
    };

    protected styleColumns(columns: Slick.Column<ISlickRow>[]) {
        // Transform columns so they are sortable and stylable
        return columns.map((c) => {
            console.log('column id', c.id);
            // Disable sorting by clicking on header
            c.sortable = false;
            c.editor = readonlyCellEditor;
            c.headerCssClass = 'react-grid-header-cell';
            c.cssClass = 'react-grid-cell';
            return c;
        });
    }
}
