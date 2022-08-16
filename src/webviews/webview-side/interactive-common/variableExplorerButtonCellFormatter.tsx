// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import * as React from 'react';
import { IJupyterVariable } from '../../../kernels/variables/types';

import { Image, ImageName } from '../react-common/image';
import { ImageButton } from '../react-common/imageButton';
import { getLocString } from '../react-common/locReactSide';

import './variableExplorerButtonCellFormatter.css';

export interface IButtonCellValue {
    supportsDataExplorer: boolean;
    name: string;
    variable?: IJupyterVariable;
    numberOfColumns: number;
}

interface IVariableExplorerButtonCellFormatterProps {
    baseTheme: string;
    value?: IButtonCellValue;
    showDataExplorer(targetVariable: IJupyterVariable, numberOfColumns: number): void;
}

export class VariableExplorerButtonCellFormatter extends React.Component<IVariableExplorerButtonCellFormatterProps> {
    public override shouldComponentUpdate(nextProps: IVariableExplorerButtonCellFormatterProps) {
        return nextProps.value !== this.props.value;
    }

    public override render() {
        const className = 'variable-explorer-button-cell';
        if (this.props.value !== null && this.props.value !== undefined) {
            if (this.props.value.supportsDataExplorer) {
                return (
                    <div className={className}>
                        <ImageButton
                            baseTheme={this.props.baseTheme}
                            tooltip={getLocString(
                                'DataScience.showDataExplorerTooltip',
                                'Show variable snapshot in data viewer'
                            )}
                            onClick={this.onDataExplorerClick}
                        >
                            <Image
                                baseTheme={this.props.baseTheme}
                                class="image-button-image"
                                image={ImageName.OpenInNewWindow}
                            />
                        </ImageButton>
                    </div>
                );
            } else {
                return null;
            }
        }
        return [];
    }

    private onDataExplorerClick = () => {
        if (this.props.value !== null && this.props.value !== undefined && this.props.value.variable) {
            this.props.showDataExplorer(this.props.value.variable, this.props.value.numberOfColumns);
        }
    };
}
