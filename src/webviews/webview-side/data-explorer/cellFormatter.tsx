// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import './cellFormatter.css';

import * as React from 'react';
import * as ReactDOMServer from 'react-dom/server';
import { ISlickRow } from './reactSlickGrid';
import { ColumnType } from '../../extension-side/dataviewer/types';

interface ICellFormatterProps {
    value: string | number | object | boolean;
    columnDef: Slick.Column<ISlickRow>;
}

class CellFormatter extends React.Component<ICellFormatterProps> {
    // eslint-disable-next-line @typescript-eslint/no-useless-constructor
    constructor(props: ICellFormatterProps) {
        super(props);
    }

    public override render() {
        // Render based on type
        if (this.props.value !== undefined && this.props.columnDef && this.props.columnDef.hasOwnProperty('type')) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const columnType = (this.props.columnDef as any).type;
            switch (columnType) {
                case ColumnType.Number:
                    return this.renderNumber(this.props.value as number);

                default:
                    break;
            }
        }
        // Otherwise an unknown type, boolean, or a string
        const val = this.props.value?.toString() ?? '';
        return (
            <div className="cell-formatter" role="gridcell" title={val}>
                <span>{val}</span>
            </div>
        );
    }

    private renderNumber(value: number) {
        let val = generateDisplayValue(value);
        const isIndexColumn = this.props.columnDef.id === '0';

        return (
            <div
                className={`number-formatter cell-formatter${isIndexColumn ? ' index-column-formatter' : ''}`}
                role="gridcell"
                title={val}
            >
                <span>{val}</span>
            </div>
        );
    }
}

export function cellFormatterFunc(
    _row: number,
    _cell: number,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: any,
    columnDef: Slick.Column<ISlickRow>,
    _dataContext: Slick.SlickData
): string {
    return ReactDOMServer.renderToString(<CellFormatter value={value} columnDef={columnDef} />);
}

export function generateDisplayValue(value: number | string) {
    value = value ?? ''; // If `value` is undefined set it to empty string
    if (Number.isNaN(value)) {
        return 'nan';
    } else if (value === Infinity) {
        return 'inf';
    } else if (value === -Infinity) {
        return '-inf';
    }
    return value.toString();
}
