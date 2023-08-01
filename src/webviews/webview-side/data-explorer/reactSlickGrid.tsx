// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { KeyCodes } from '../react-common/constants';
import { measureText } from '../react-common/textMeasure';
import './globalJQueryImports';
import { ReactSlickGridFilterBox } from './reactSlickGridFilterBox';

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
import './reactSlickGrid.css';
import { generateDisplayValue } from './cellFormatter';
import { getLocString } from '../react-common/locReactSide';
import { buildDataViewerFilterRegex } from '../../../platform/common/utils/regexp';
import { IGetSliceRequest, ColumnType, MaxStringCompare } from '../../extension-side/dataviewer/types';
/*
WARNING: Do not change the order of these imports.
Slick grid MUST be imported after we load jQuery and other stuff from `./globalJQueryImports`
*/

export interface ISlickRow extends Slick.SlickData {
    id: string;
}

export interface ISlickGridAdd {
    newRows: ISlickRow[];
}

export interface ISlickGridSlice {
    columns: Slick.Column<Slick.SlickData>[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ISlickGridProps {
    idProperty: string;
    columns: Slick.Column<ISlickRow>[];
    rowsAdded: Slick.Event<ISlickGridAdd>;
    resetGridEvent: Slick.Event<ISlickGridSlice>;
    resizeGridEvent: Slick.Event<void>;
    columnsUpdated: Slick.Event<Slick.Column<Slick.SlickData>[]>;
    filterRowsTooltip: string;
    forceHeight?: number;
    dataDimensionality: number;
    originalVariableShape: number[] | undefined;
    isSliceDataEnabled: boolean; // Feature flag. This should eventually be removed
    handleSliceRequest(args: IGetSliceRequest): void;
    handleRefreshRequest(): void;
}

interface ISlickGridState {
    grid?: Slick.Grid<ISlickRow>;
    showingFilters?: boolean;
    fontSize: number;
}

class ColumnFilter {
    private matchFunc: (v: any) => boolean;
    private nanRegEx = /^\s*nan.*/i;
    private infRegEx = /^\s*inf.*/i;
    private negInfRegEx = /^\s*-inf.*/i;
    private lessThanRegEx = /^\s*<\s*((?<Number>-?\d+.*)|(?<NaN>nan)|(?<Inf>inf)|(?<NegInf>-inf))/i;
    private lessThanEqualRegEx = /^\s*<=\s*((?<Number>-?\d+.*)|(?<NaN>nan)|(?<Inf>inf)|(?<NegInf>-inf)).*/i;
    private greaterThanRegEx = /^\s*>\s*((?<Number>-?\d+.*)|(?<NaN>nan)|(?<Inf>inf)|(?<NegInf>-inf)).*/i;
    private greaterThanEqualRegEx = /^\s*>=\s*((?<Number>-?\d+.*)|(?<NaN>nan)|(?<Inf>inf)|(?<NegInf>-inf)).*/i;
    private equalToRegEx = /^\s*(?:=|==)\s*((?<Number>-?\d+.*)|(?<NaN>nan)|(?<Inf>inf)|(?<NegInf>-inf)).*/i;
    private textRegex: RegExp | undefined;

    constructor(
        public text: string,
        column: Slick.Column<Slick.SlickData>
    ) {
        if (text && text.length > 0) {
            const columnType = (column as any).type;
            switch (columnType) {
                case ColumnType.Number:
                    this.matchFunc = this.generateNumericOperation(text);
                    break;

                case ColumnType.String:
                default:
                    this.textRegex = buildDataViewerFilterRegex(text);
                    this.matchFunc = (v: any) => this.matchStringWithWildcards(v);
                    break;
            }
        } else {
            this.matchFunc = (_v: any) => true;
        }
    }

    public matches(value: any): boolean {
        return this.matchFunc(value);
    }

    // Tries to match entire words instead of possibly trying to match substrings.
    private matchStringWithWildcards(v: any): boolean {
        try {
            return this.textRegex ? this.textRegex.test(v) : false;
        } catch (e) {
            return false;
        }
    }

    private extractDigits(text: string, regex: RegExp): number {
        const match = regex.exec(text);
        if (match && match.groups) {
            if (match.groups.Number) {
                return parseFloat(match.groups.Number);
            } else if (match.groups.Inf) {
                return Infinity;
            } else if (match.groups.NegInf) {
                return -Infinity;
            } else if (match.groups.NaN) {
                return NaN;
            }
        }
        return 0;
    }

    private generateNumericOperation(text: string): (v: any) => boolean {
        if (this.nanRegEx.test(text)) {
            return (v: any) => v !== undefined && Number.isNaN(v);
        } else if (this.infRegEx.test(text)) {
            return (v: any) => v !== undefined && v === Infinity;
        } else if (this.negInfRegEx.test(text)) {
            return (v: any) => v !== undefined && v === -Infinity;
        } else if (this.lessThanRegEx.test(text)) {
            const n1 = this.extractDigits(text, this.lessThanRegEx);
            return (v: any) => v !== undefined && v < n1;
        } else if (this.lessThanEqualRegEx.test(text)) {
            const n2 = this.extractDigits(text, this.lessThanEqualRegEx);
            return (v: any) => v !== undefined && (v <= n2 || (Number.isNaN(v) && Number.isNaN(n2)));
        } else if (this.greaterThanRegEx.test(text)) {
            const n3 = this.extractDigits(text, this.greaterThanRegEx);
            return (v: any) => v !== undefined && v > n3;
        } else if (this.greaterThanEqualRegEx.test(text)) {
            const n4 = this.extractDigits(text, this.greaterThanEqualRegEx);
            return (v: any) => v !== undefined && (v >= n4 || (Number.isNaN(v) && Number.isNaN(n4)));
        } else if (this.equalToRegEx.test(text)) {
            const n5 = this.extractDigits(text, this.equalToRegEx);
            return (v: any) => v !== undefined && (v === n5 || (Number.isNaN(v) && Number.isNaN(n5)));
        } else {
            const n6 = parseFloat(text);
            return (v: any) => v !== undefined && parseFloat(v) === n6;
        }
    }
}

export class ReactSlickGrid extends React.Component<ISlickGridProps, ISlickGridState> {
    private containerRef: React.RefObject<HTMLDivElement>;
    private measureRef: React.RefObject<HTMLDivElement>;
    private dataView: Slick.Data.DataView<ISlickRow> = new Slick.Data.DataView();
    private columnFilters: Map<string, ColumnFilter> = new Map<string, ColumnFilter>();
    private resizeTimer?: number;
    private autoResizedColumns: boolean = false;

    constructor(props: ISlickGridProps) {
        super(props);
        this.state = { fontSize: 15, showingFilters: true };
        this.containerRef = React.createRef<HTMLDivElement>();
        this.measureRef = React.createRef<HTMLDivElement>();
        this.props.rowsAdded.subscribe(this.addedRows);
        this.props.resetGridEvent.subscribe(this.resetGrid);
        this.props.resizeGridEvent.subscribe(this.windowResized);
        this.props.columnsUpdated.subscribe(this.updateColumns);
    }

    // eslint-disable-next-line
    public override componentDidMount = () => {
        window.addEventListener('resize', this.windowResized);

        if (this.containerRef.current) {
            // Compute font size. Default to 15 if not found.
            let fontSize = parseInt(
                getComputedStyle(this.containerRef.current).getPropertyValue('--vscode-font-size'),
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

            // Setup the sorting
            grid.onSort.subscribe(this.sort);

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

    public override componentWillUnmount = () => {
        if (this.resizeTimer) {
            window.clearTimeout(this.resizeTimer);
        }
        window.removeEventListener('resize', this.windowResized);
        if (this.state.grid) {
            this.state.grid.destroy();
        }
    };

    public override componentDidUpdate = (_prevProps: ISlickGridProps) => {
        if (this.state.showingFilters && this.state.grid) {
            this.state.grid.setHeaderRowVisibility(true);
        } else if (this.state.showingFilters === false && this.state.grid) {
            this.state.grid.setHeaderRowVisibility(false);
        }
        // Dynamically modify the styles that the slickGrid generates for the rows.
        // It's eliminating some of the height
        if (this.state.grid && this.containerRef.current) {
            this.updateCssStyles();
        }
    };

    public override render() {
        const style: React.CSSProperties = this.props.forceHeight
            ? {
                  height: `${this.props.forceHeight}px`,
                  width: `${this.props.forceHeight}px`
              }
            : {};

        return (
            <div className="outer-container">
                <div className="react-grid-container" style={style} ref={this.containerRef}></div>
                <div className="react-grid-measure" ref={this.measureRef} />
            </div>
        );
    }

    // public for testing
    public sort = (_e: Slick.EventData, args: Slick.OnSortEventArgs<Slick.SlickData>) => {
        // Note: dataView.fastSort is an IE workaround. Not necessary.
        this.dataView.sort((l: any, r: any) => this.compareElements(l, r, args.sortCol), args.sortAsc);
        args.grid.invalidateAllRows();
        args.grid.render();
    };

    // Public for testing
    public filterChanged = (text: string, column: Slick.Column<Slick.SlickData>) => {
        if (column && column.field) {
            this.columnFilters.set(column.field, new ColumnFilter(text, column));
            this.dataView.refresh();
        }
    };

    private clearAllFilters = () => {
        // Avoid rerendering if there are no filters
        if (this.columnFilters.size > 0) {
            this.columnFilters = new Map();
            this.dataView.refresh();
            // Force column headers to rerender by setting columns
            // and ensure styles don't get messed up after rerender
            this.autoResizeColumns();
        }
    };

    private styleColumns(columns: Slick.Column<ISlickRow>[]) {
        // Transform columns so they are sortable and stylable
        return columns.map((c) => {
            c.sortable = true;
            c.editor = readonlyCellEditor;
            c.headerCssClass = 'react-grid-header-cell';
            c.cssClass = 'react-grid-cell';
            return c;
        });
    }

    // These adjustments for the row height come from trial and error, by changing the font size in VS code,
    // opening a new Data Viewer, and making sure the data is visible
    // They were tested up to a font size of 60, and the row height still allows the content to be seen
    private getAppropiateRowHeight(fontSize: number): number {
        switch (true) {
            case fontSize < 15:
                return fontSize + 4 + 8; // +8 for padding
            case fontSize < 20:
                return fontSize + 8 + 8; // +8 for padding
            case fontSize < 30:
                return fontSize + 10 + 8; // +8 for padding
            default:
                return fontSize + 12 + 8; // +8 for padding
        }
    }

    // If the slickgrid gets focus and nothing is selected select the first item
    // so that you can keyboard navigate from there
    private slickgridFocus = (_e: any): void => {
        if (this.state.grid) {
            if (!this.state.grid.getActiveCell()) {
                this.state.grid.setActiveCell(0, 1);
            }
        }
    };

    private slickgridHandleKeyDown = (e: KeyboardEvent): void => {
        let handled: boolean = false;

        // Defined here:
        // https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/Grid_Role#Keyboard_interactions

        if (this.state.grid) {
            // The slickgrid version of jquery populates keyCode not code, so use the numerical values here
            switch (e.keyCode) {
                case KeyCodes.LeftArrow:
                    this.state.grid.navigateLeft();
                    handled = true;
                    break;
                case KeyCodes.UpArrow:
                    this.state.grid.navigateUp();
                    handled = true;
                    break;
                case KeyCodes.RightArrow:
                    this.state.grid.navigateRight();
                    handled = true;
                    break;
                case KeyCodes.DownArrow:
                    this.state.grid.navigateDown();
                    handled = true;
                    break;
                case KeyCodes.PageUp:
                    this.state.grid.navigatePageUp();
                    handled = true;
                    break;
                case KeyCodes.PageDown:
                    this.state.grid.navigatePageDown();
                    handled = true;
                    break;
                case KeyCodes.End:
                    e.ctrlKey ? this.state.grid.navigateBottom() : this.state.grid.navigateRowEnd();
                    handled = true;
                    break;
                case KeyCodes.Home:
                    e.ctrlKey ? this.state.grid.navigateTop() : this.state.grid.navigateRowStart();
                    handled = true;
                    break;
                default:
            }
        }

        if (handled) {
            // Don't let the parent / browser do stuff if we handle it
            // otherwise we'll both move the cell selection and scroll the window
            // with up and down keys
            e.stopPropagation();
            e.preventDefault();
        }
    };

    private updateCssStyles = () => {
        if (this.state.grid && this.containerRef.current) {
            const gridName = (this.state.grid as any).getUID() as string;
            const document = this.containerRef.current.ownerDocument;
            if (document) {
                const cssOverrideNode = document.createElement('style');
                const rule = `.${gridName} .slick-cell {height: ${this.getAppropiateRowHeight(
                    this.state.fontSize
                )}px;}`;
                cssOverrideNode.setAttribute('type', 'text/css');
                cssOverrideNode.setAttribute('rel', 'stylesheet');
                cssOverrideNode.appendChild(document.createTextNode(rule));
                document.head.appendChild(cssOverrideNode);
            }
        }
    };

    private windowResized = () => {
        if (this.resizeTimer) {
            clearTimeout(this.resizeTimer);
        }
        this.resizeTimer = window.setTimeout(this.updateGridSize, 10);
    };

    private updateGridSize = () => {
        if (this.state.grid && this.containerRef.current && this.measureRef.current) {
            // We use a div at the bottom to figure out our expected height. Slickgrid isn't
            // so good without a specific height set in the style.
            const height = this.measureRef.current.offsetTop - this.containerRef.current.offsetTop;
            this.containerRef.current.style.height = `${this.props.forceHeight ? this.props.forceHeight : height}px`;
            this.state.grid.resizeCanvas();
        }
    };

    private autoResizeColumns() {
        if (this.state.grid) {
            const fontString = this.computeFont();
            const columns = this.state.grid.getColumns();
            const placeholder = '99999999999';
            const maxFieldWidth = measureText(placeholder, fontString);
            columns.forEach((c) => {
                if (c.field !== this.props.idProperty) {
                    c.width = maxFieldWidth;
                } else {
                    c.width = (maxFieldWidth / 5) * 4;
                    c.name = '';
                    c.header = {
                        buttons: [
                            {
                                cssClass: 'codicon codicon-filter codicon-button header-cell-button',
                                handler: this.clickFilterButton,
                                tooltip: this.state.showingFilters
                                    ? getLocString('dataViewerHideFilters', 'Hide filters')
                                    : getLocString('dataViewerShowFilters', 'Show filters')
                            },
                            {
                                cssClass: 'codicon codicon-refresh codicon-button header-cell-button refresh-button',
                                handler: this.props.handleRefreshRequest,
                                tooltip: getLocString('refreshDataViewer', 'Refresh data viewer')
                            }
                        ]
                    };
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

    private clickFilterButton = () => {
        this.setState({ showingFilters: !this.state.showingFilters });
        // Force column headers to rerender by setting columns
        // and ensure styles don't get messed up after rerender
        this.autoResizeColumns();
    };

    private computeFont(): string | null {
        if (this.containerRef.current) {
            const style = getComputedStyle(this.containerRef.current);
            return style ? style.font : null;
        }
        return null;
    }

    private resetGrid = (_e: Slick.EventData, data: ISlickGridSlice) => {
        this.dataView.setItems([]);
        const styledColumns = this.styleColumns(data.columns);
        this.setColumns(styledColumns);
    };

    private updateColumns = (_e: Slick.EventData, newColumns: Slick.Column<Slick.SlickData>[]) => {
        this.setColumns(newColumns);
        this.state.grid?.render(); // We might be able to skip this rerender?
    };

    private setColumns = (newColumns: Slick.Column<Slick.SlickData>[]) => {
        // HACK: SlickGrid header row does not rerender if its visibility is false when columns
        // are updated, and this causes the header to simply not show up when clicking the
        // filter button after we update the grid column headers on receiving a slice response.
        // The solution is to force the header row to become visible just before sending our slice request.
        this.state.grid?.setHeaderRowVisibility(true);
        this.state.grid?.setColumns(newColumns);
        this.autoResizeColumns();
    };

    private addedRows = (_e: Slick.EventData, data: ISlickGridAdd) => {
        // Add all of these new rows into our data.
        this.dataView.beginUpdate();
        for (const row of data.newRows) {
            this.dataView.addItem(row);
        }

        // Update columns if we haven't already
        if (!this.autoResizedColumns) {
            this.autoResizedColumns = true;
            this.autoResizeColumns();
        }

        this.dataView.endUpdate();

        // This should cause a rowsChanged event in the dataview that will
        // refresh the grid.
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private filter(item: any, _args: any): boolean {
        const fields = Array.from(this.columnFilters.keys());
        for (const field of fields) {
            if (field) {
                const filter = this.columnFilters.get(field);
                if (filter) {
                    if (!filter.matches(item[field])) {
                        return false;
                    }
                }
            }
        }
        return true;
    }

    private renderFilterCell = (_e: Slick.EventData, args: Slick.OnHeaderRowCellRenderedEventArgs<Slick.SlickData>) => {
        if (args.column.field === this.props.idProperty) {
            const tooltipText = getLocString('clearFilters', 'Clear all filters');
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
        }
    };

    private compareElements(a: any, b: any, col?: Slick.Column<Slick.SlickData>): number {
        if (col) {
            const sortColumn = col.field;
            if (sortColumn && col.hasOwnProperty('type')) {
                const columnType = (col as any).type;
                const isStringColumn = columnType === 'string' || columnType === 'object';
                if (isStringColumn) {
                    // Check if a or b is a missing value first and if so, put them at the end
                    if (a[sortColumn].toString().toLowerCase() === 'nan') {
                        return 1;
                    } else if (b[sortColumn].toString().toLowerCase() === 'nan') {
                        return -1;
                    }
                    const aVal = a[sortColumn] ? a[sortColumn].toString() : '';
                    const bVal = b[sortColumn] ? b[sortColumn].toString() : '';
                    const aStr = aVal ? aVal.substring(0, Math.min(aVal.length, MaxStringCompare)) : aVal;
                    const bStr = bVal ? bVal.substring(0, Math.min(bVal.length, MaxStringCompare)) : bVal;
                    return aStr.localeCompare(bStr);
                } else {
                    const aVal = a[sortColumn];
                    const bVal = b[sortColumn];
                    // Check for NaNs and put them at the end
                    if (Number.isNaN(aVal)) {
                        return 1;
                    } else if (Number.isNaN(bVal)) {
                        return -1;
                    }
                    return aVal === bVal ? 0 : aVal > bVal ? 1 : -1;
                }
            }
        }

        // No sort column, try index column
        if (a.hasOwnProperty(this.props.idProperty) && b.hasOwnProperty(this.props.idProperty)) {
            const sortColumn = this.props.idProperty;
            const aVal = a[sortColumn];
            const bVal = b[sortColumn];
            return aVal === bVal ? 0 : aVal > bVal ? 1 : -1;
        }

        return -1;
    }
}

// Modified version of https://github.com/6pac/SlickGrid/blob/master/slick.editors.js#L24
// with some fixes to get things working in our context
function readonlyCellEditor(this: any, args: any) {
    var $input: any;
    var defaultValue: any;

    this.init = function init() {
        $input = slickgridJQ("<input type=text class='editor-text'/>")
            .appendTo(args.container)
            .on('keydown.nav', handleKeyDown)
            .focus();
    };

    this.destroy = function destroy() {
        $input.remove();
    };

    this.focus = function focus() {
        $input.focus();
    };

    this.isValueChanged = function isValueChanged() {
        return false;
    };

    this.loadValue = function loadValue(item: any) {
        defaultValue = generateDisplayValue(item[args.column.field]);
        $input.val(defaultValue);
        $input[0].defaultValue = defaultValue;
    };

    this.applyValue = function applyValue() {
        // Noop as we never want to overwrite the cell's value.
        // Defined to avoid polluting the console with typeerrors
    };

    this.validate = function validate() {
        return {
            valid: true,
            msg: null
        };
    };

    this.serializeValue = function serializeValue() {
        // Defined to avoid polluting the console with typeerrors
        return $input.val();
    };

    function handleKeyDown(this: any, e: KeyboardEvent) {
        var cursorPosition = this.selectionStart;
        var textLength = this.value.length;
        // In the original SlickGrid TextEditor this references
        // $.ui.keyDown.LEFT which is undefined, so couldn't use
        // that out of the box if we wanted to allow the user
        // to move their cursor within the focused input element
        if (
            (e.keyCode === KeyCodes.LeftArrow && cursorPosition > 0) ||
            (e.keyCode === KeyCodes.RightArrow && cursorPosition < textLength - 1) ||
            (e.ctrlKey && e.keyCode === KeyCodes.X)
        ) {
            e.stopImmediatePropagation();
        }
        // Readonly input elements do not have a cursor, but we want the user to be able
        // to navigate the cell via cursor and left/right arrows. Solution is to make
        // the input editable, but suppress printable keys or keys which would modify
        // the input
        if (
            e.key.length === 1 ||
            e.keyCode === KeyCodes.Backspace ||
            e.keyCode === KeyCodes.Delete ||
            e.keyCode === KeyCodes.Insert
        ) {
            e.preventDefault();
        }
    }

    this.init();
}
