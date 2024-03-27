// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as React from 'react';

import './reactSlickGridFilterBox.css';



interface IFilterProps {
    column: Slick.Column<Slick.SlickData>;
    fontSize: number;
    filter: string;
    onChange(val: string, column: Slick.Column<Slick.SlickData>): void;
}

export class ReactSlickGridFilterBox extends React.Component<IFilterProps> {
    public override render() {
        return (
            <input
                onChange={this.updateInputValue}
                tabIndex={0}
                aria-label={this.props.column.name}
                className="filter-box"
            />
        );
    }

    private updateInputValue = (event: React.ChangeEvent<HTMLInputElement>) => {
        this.props.onChange(event.target.value ?? '', this.props.column);
    };
}
