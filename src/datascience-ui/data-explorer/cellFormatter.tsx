// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import './cellFormatter.css';

import * as React from 'react';
import * as ReactDOMServer from 'react-dom/server';
import { ColumnType } from '../../client/datascience/data-viewing/types';
import { ISlickRow } from './reactSlickGrid';

interface ICellFormatterProps {
    value: string | number | object | boolean;
    columnDef: Slick.Column<ISlickRow>;
}

class CellFormatter extends React.Component<ICellFormatterProps> {
    constructor(props: ICellFormatterProps) {
        super(props);
    }

    public render() {
        // Render based on type
        if (this.props.value !== null && this.props.columnDef && this.props.columnDef.hasOwnProperty('type')) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const columnType = (this.props.columnDef as any).type;
            switch (columnType) {
                case ColumnType.Bool:
                    return this.renderBool(this.props.value as boolean);
                    break;

                case ColumnType.Number:
                    return this.renderNumber(this.props.value as number);
                    break;

                default:
                    break;
            }
        }

        // Otherwise an unknown type or a string
        const val = this.props.value !== null ? this.props.value.toString() : '';
        return (
            <div className="cell-formatter" role="gridcell" title={val}>
                <span>{val}</span>
            </div>
        );
    }

    private renderBool(value: boolean) {
        return (
            <div className="cell-formatter" role="gridcell" title={value.toString()}>
                <span>{value.toString()}</span>
            </div>
        );
    }

    private renderNumber(value: number) {
        const val = value.toString();
        return (
            <div className="number-formatter cell-formatter" role="gridcell" title={val}>
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
