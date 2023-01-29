// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as React from 'react';
import { IIconProps, SearchBox } from '@fluentui/react';

import './reactSlickGridFilterBox.css';

const filterIcon: IIconProps = {
    iconName: 'Filter',
    styles: {
        root: {
            fontSize: 'var(--vscode-font-size)',
            width: 'var(--vscode-font-size)',
            color: 'var(--vscode-settings-textInputForeground)'
        }
    }
};

const styles = {
    iconContainer: {
        opacity: 0.4
    },
    root: {
        '::after': {
            borderRadius: '0px',
            border: '1px solid var(--vscode-focusBorder)'
        }
    },
    field: {
        color: 'var(--vscode-settings-textInputForeground)'
    }
};

interface IFilterProps {
    column: Slick.Column<Slick.SlickData>;
    fontSize: number;
    filter: string;
    onChange(val: string, column: Slick.Column<Slick.SlickData>): void;
}

export class ReactSlickGridFilterBox extends React.Component<IFilterProps> {
    public override render() {
        return (
            <SearchBox
                iconProps={filterIcon}
                onChange={this.updateInputValue}
                onClear={this.clearInputValue}
                tabIndex={0}
                ariaLabel={this.props.column.name}
                className="filter-box"
                styles={styles}
                value={this.props.filter}
            />
        );
    }

    private clearInputValue = () => {
        this.props.onChange('', this.props.column);
    };

    private updateInputValue = (
        _event?: React.ChangeEvent<HTMLInputElement> | undefined,
        newValue?: string | undefined
    ) => {
        this.props.onChange(newValue ?? '', this.props.column);
    };
}
