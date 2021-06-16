import { Dropdown, IDropdownOption, ResponsiveMode } from '@fluentui/react';
import * as React from 'react';
import { DropColumnsSection } from './DropColumnSection';
import { DropMissingColumnsSection } from './DropMissingColumnsSection';
import { NormalizeDataSection } from './NormalizeDataSection';
import { RenameColumnsSection } from './RenameColumnsSection';
import { SidePanelSection } from './SidePanelSection';
import { dropdownStyles } from './styles';

interface IProps {
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
    DropNA = 'Remove Missing Values'
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

        return <SidePanelSection title="COLUMNS" panel={columnsComponent} />;
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
