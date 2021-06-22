import { Dropdown, IDropdownOption, ResponsiveMode } from '@fluentui/react';
import * as React from 'react';
import { CoerceColumnsSection } from './column-operations/CoerceColumnsSection';
import { DropColumnsSection } from './column-operations/DropColumnSection';
import { DropMissingColumnsSection } from './column-operations/DropMissingColumnsSection';
import { NormalizeDataSection } from './column-operations/NormalizeDataSection';
import { RenameColumnsSection } from './column-operations/RenameColumnsSection';
import { SidePanelSection } from './SidePanelSection';
import { dropdownStyles } from './styles';

interface IProps {
    collapsed: boolean;
    headers: string[];
    options: IDropdownOption[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    submitCommand(data: { command: string; args: any }): void;
}

interface IState {
    columnsToDrop: number[]; // Indices
    operationType: ColumnTransformation;
}

export enum ColumnTransformation {
    Drop = 'Drop',
    Rename = 'Rename',
    Normalize = 'Normalize',
    DropNA = 'Remove Missing Values',
    CoerceColumns = "Coerce Column Type"
}

export class ColumnsSection extends React.Component<IProps, IState> {
    constructor(props: IProps) {
        super(props);
        this.state = { columnsToDrop: [], operationType: ColumnTransformation.Drop };
    }

    render() {
        const columnsComponent = (
            <div className="slice-form-container" style={{ paddingBottom: '5px', marginTop: '10px' }}>
                <Dropdown
                    responsiveMode={ResponsiveMode.xxxLarge}
                    label={'Operation'}
                    style={{ marginRight: '10px', width: '150px', marginBottom: '16px' }}
                    styles={dropdownStyles}
                    options={this.generateTransformOperations()}
                    className="dropdownTitleOverrides"
                    onChange={this.updateTransformType}
                    selectedKey={this.state.operationType}
                />
                {this.renderOperationControls()}
            </div>
        );

        return <SidePanelSection title="COLUMNS" panel={columnsComponent} collapsed={this.props.collapsed}/>;
    }

    private renderOperationControls = () => {
        switch (this.state.operationType) {
            case ColumnTransformation.Drop:
                return (
                    <DropColumnsSection
                        headers={this.props.headers}
                        options={this.props.options}
                        submitCommand={this.props.submitCommand}
                    />
                );
            case ColumnTransformation.Rename:
                return (
                    <RenameColumnsSection
                        headers={this.props.headers}
                        options={this.props.options}
                        submitCommand={this.props.submitCommand}
                    />
                );
            case ColumnTransformation.Normalize:
                return (
                    <NormalizeDataSection
                        headers={this.props.headers}
                        options={this.props.options}
                        submitCommand={this.props.submitCommand}
                    />
                );
            case ColumnTransformation.DropNA:
                return (
                    <DropMissingColumnsSection
                        headers={this.props.headers}
                        options={this.props.options}
                        submitCommand={this.props.submitCommand}
                    />
                );
            case ColumnTransformation.CoerceColumns:
                return (
                    <CoerceColumnsSection
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
                text: ColumnTransformation.Drop,
                key: ColumnTransformation.Drop
            },
            {
                text: ColumnTransformation.Normalize,
                key: ColumnTransformation.Normalize
            },
            {
                text: ColumnTransformation.DropNA,
                key: ColumnTransformation.DropNA
            },
            {
                text: ColumnTransformation.Rename,
                key: ColumnTransformation.Rename
            },
            {
                text: ColumnTransformation.CoerceColumns,
                key: ColumnTransformation.CoerceColumns
            }
        ];
    };

    private updateTransformType = (_data: React.FormEvent, item: IDropdownOption | undefined) => {
        if (item) {
            this.setState({
                operationType: item.text as ColumnTransformation
            });
        }
    };
}
