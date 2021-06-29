import { Dropdown, IDropdownOption, ResponsiveMode } from '@fluentui/react';
import * as React from 'react';
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
    operationType: RowTransformation;
}

export enum RowTransformation {
    DropNA = 'Drop NA',
    DropDuplicates = 'Drop Duplicates'
}

export class RowsSection extends React.Component<IProps, IState> {
    constructor(props: IProps) {
        super(props);
        this.state = { columnsToDrop: [], operationType: RowTransformation.DropNA };
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
                {this.renderOperationControls()}
            </div>
        );

        return <SidePanelSection title="ROWS" panel={rowsComponent} collapsed={this.props.collapsed}/>
    }

    private renderOperationControls = () => {
        switch (this.state.operationType) {
            case RowTransformation.DropNA:
                return (
                    <DropMissingRowsSection
                        headers={this.props.headers}
                        options={this.props.options}
                        submitCommand={this.props.submitCommand}
                    />
                );
            case RowTransformation.DropDuplicates:
                return (
                    <DropDuplicateRowsSection
                        headers={this.props.headers}
                        options={this.props.options}
                        submitCommand={this.props.submitCommand}
                    />
                );
        }
    };

    private generateTransformOperations = () => {
        return [
            {
                text: RowTransformation.DropDuplicates,
                key: RowTransformation.DropDuplicates
            },
            {
                text: RowTransformation.DropNA,
                key: RowTransformation.DropNA
            }
        ];
    };

    private updateTransformType = (_data: React.FormEvent, item: IDropdownOption | undefined) => {
        if (item) {
            this.setState({
                operationType: item.text as RowTransformation
            });
        }
    };
}
