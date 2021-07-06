import { Dropdown, IDropdownOption, ResponsiveMode } from '@fluentui/react';
import * as React from 'react';
import { getLocString } from '../../../react-common/locReactSide';
import { DropDuplicateRowsSection } from './row-operations/DropDuplicateRows';
import { DropMissingRowsSection } from './row-operations/DropMissingRowsSection';
import { SidePanelSection } from './SidePanelSection';
import { dropdownStyle, dropdownStyles } from './styles';

interface IProps {
    collapsed: boolean;
    headers: string[];
    options: IDropdownOption[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    submitCommand(data: { command: string; args: any }): void;
}

interface IState {
    columnsToDrop: number[]; // Indices
    operationType: RowOperation;
}

export enum RowOperation {
    DropNA = 'Drop Missing Values',
    DropDuplicates = 'Drop Duplicates'
}

const rowOperationInfo = {
    [RowOperation.DropNA]:{
        tooltip: getLocString('DataScience.dataWranglerDropNARowsTooltip', 'Remove rows with missing values')
    },
    [RowOperation.DropDuplicates]: {
        tooltip: getLocString('DataScience.dataWranglerDropDuplicateRowsTooltip', 'Remove duplicate rows')
    }
};

export class RowsSection extends React.Component<IProps, IState> {
    constructor(props: IProps) {
        super(props);
        this.state = { columnsToDrop: [], operationType: RowOperation.DropNA };
    }

    render() {
        const rowsComponent = (
            <div className="slice-form-container" style={{ paddingBottom: '5px', marginTop: '10px' }}>
                <Dropdown
                    responsiveMode={ResponsiveMode.xxxLarge}
                    label={'Operation'}
                    style={dropdownStyle}
                    styles={dropdownStyles}
                    options={this.generateTransformOperations()}
                    className="dropdownTitleOverrides"
                    onChange={this.updateTransformType}
                    selectedKey={this.state.operationType}
                />
                {this.state.operationType && (
                    <div style={{ color: 'var(--vscode-descriptionForeground)', marginBottom: '4px' }}>
                        <span>{rowOperationInfo[this.state.operationType].tooltip}</span>
                    </div>
                )}
                {this.renderOperationControls()}
            </div>
        );

        return <SidePanelSection title="ROWS" panel={rowsComponent} collapsed={this.props.collapsed} />;
    }

    private renderOperationControls = () => {
        switch (this.state.operationType) {
            case RowOperation.DropNA:
                return <DropMissingRowsSection submitCommand={this.props.submitCommand} />;
            case RowOperation.DropDuplicates:
                return <DropDuplicateRowsSection submitCommand={this.props.submitCommand} />;
        }
    };

    private generateTransformOperations = () => {
        return Object.keys(rowOperationInfo).map((operation) => {
            return { text: operation, key: operation, title: rowOperationInfo[operation as RowOperation].tooltip };
        });
    };

    private updateTransformType = (_data: React.FormEvent, item: IDropdownOption | undefined) => {
        if (item) {
            this.setState({
                operationType: item.text as RowOperation
            });
        }
    };
}
