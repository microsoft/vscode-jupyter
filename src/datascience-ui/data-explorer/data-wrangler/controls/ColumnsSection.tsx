import { Dropdown, IDropdownOption, ResponsiveMode } from '@fluentui/react';
import * as React from 'react';
import { CoerceColumnsSection } from './column-operations/CoerceColumnsSection';
import { DropColumnsSection } from './column-operations/DropColumnSection';
import { DropMissingColumnsSection } from './column-operations/DropMissingColumnsSection';
import { NormalizeDataSection } from './column-operations/NormalizeDataSection';
import { RenameColumnsSection } from './column-operations/RenameColumnsSection';
import { ReplaceAllColumnsSection } from './column-operations/ReplaceAllColumnsSection';
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
    selectedColumns: number[]; // Indices
    operationType: ColumnOperation | null;
}

export enum ColumnOperation {
    Drop = 'Drop',
    Rename = 'Rename',
    Normalize = 'Normalize',
    DropNA = 'Remove Missing Values',
    Coerce = 'Coerce',
    ReplaceAll = 'Replace All'
}

export class ColumnsSection extends React.Component<IProps, IState> {
    private multiSelectColumnOperations = [
        ColumnOperation.Drop,
        ColumnOperation.DropNA,
        ColumnOperation.ReplaceAll,
        ColumnOperation.Coerce
    ];

    constructor(props: IProps) {
        super(props);
        this.state = { operationType: null, selectedColumns: [] };
    }

    render() {
        const columnsComponent = (
            <div className="slice-form-container" style={{ paddingBottom: '5px', marginTop: '10px' }}>
                <Dropdown
                    multiSelect={true}
                    responsiveMode={ResponsiveMode.xxxLarge}
                    label={'Select the column(s) you want to modify:'}
                    style={{ marginRight: '10px', width: '150px', marginBottom: '16px' }}
                    styles={dropdownStyles}
                    options={this.generateOptions()}
                    className="dropdownTitleOverrides"
                    onChange={this.updateSelectedColumnsTarget.bind(this)}
                    selectedKeys={this.state.selectedColumns}
                />
                <Dropdown
                    responsiveMode={ResponsiveMode.xxxLarge}
                    label={'Operation'}
                    style={{ marginRight: '10px', width: '150px', marginBottom: '16px' }}
                    styles={dropdownStyles}
                    options={this.generatePossibleColumnOperations()}
                    className="dropdownTitleOverrides"
                    onChange={this.updateSelectedOperation.bind(this)}
                    selectedKey={this.state.operationType}
                />
                {this.state.selectedColumns.length > 0 && this.renderOperationControls()}
            </div>
        );

        return <SidePanelSection title="COLUMNS" panel={columnsComponent} collapsed={this.props.collapsed} />;
    }

    private generateOptions() {
        const selectAll = { key: -1, text: 'Select All' };
        return [selectAll, ...this.props.options.filter((option) => option.text !== 'index')]; // Don't let user drop the index column
    }

    private generatePossibleColumnOperations(): IDropdownOption[] {
        // Possible column operations will depend on amount of selected options
        const possibleColumnOperations = [];

        if (this.state.selectedColumns.length === 0) {
            // No selected columns. All operations should be disabled.
            for (const operation of Object.values(ColumnOperation)) {
                const option = { key: operation, text: operation, disabled: true };
                possibleColumnOperations.push(option);
            }
        } else if (this.state.selectedColumns.length > 1) {
            // Multiple selected columns. Single operations should be disabled.
            for (const operation of Object.values(ColumnOperation)) {
                const disabled = !this.multiSelectColumnOperations.includes(operation);
                const option = { key: operation, text: operation, disabled: disabled };
                possibleColumnOperations.push(option);
            }
        } else {
            // One selected column. No operations should be disabled.
            for (const operation of Object.values(ColumnOperation)) {
                const option = { key: operation, text: operation };
                possibleColumnOperations.push(option);
            }
        }

        return possibleColumnOperations;
    }

    private renderOperationControls() {
        console.log('operation type', this.state.operationType);
        switch (this.state.operationType) {
            case ColumnOperation.Drop:
                return (
                    <DropColumnsSection
                        selectedColumns={this.getSelectedColumns()}
                        setColumns={this.setColumns.bind(this)}
                        submitCommand={this.props.submitCommand}
                    />
                );
            case ColumnOperation.Rename:
                return (
                    <RenameColumnsSection
                        selectedColumn={this.getSelectedColumns()[0]}
                        setColumns={this.setColumns.bind(this)}
                        submitCommand={this.props.submitCommand}
                    />
                );
            case ColumnOperation.Normalize:
                return (
                    <NormalizeDataSection
                        selectedColumn={this.getSelectedColumns()[0]}
                        setColumns={this.setColumns.bind(this)}
                        submitCommand={this.props.submitCommand}
                    />
                );
            case ColumnOperation.DropNA:
                return (
                    <DropMissingColumnsSection
                        selectedColumns={this.getSelectedColumns()}
                        setColumns={this.setColumns.bind(this)}
                        submitCommand={this.props.submitCommand}
                    />
                );
            case ColumnOperation.Coerce:
                return (
                    <CoerceColumnsSection
                        selectedColumns={this.getSelectedColumns()}
                        setColumns={this.setColumns.bind(this)}
                        submitCommand={this.props.submitCommand}
                    />
                );
            case ColumnOperation.ReplaceAll:
                return (
                    <ReplaceAllColumnsSection
                        selectedColumns={this.getSelectedColumns()}
                        setColumns={this.setColumns.bind(this)}
                        submitCommand={this.props.submitCommand}
                    />
                );
            default:
                return <></>;
        }
    }

    private getSelectedColumns() {
        return this.state.selectedColumns
            .filter((v) => v !== -1)
            .map((v) => this.props.headers[v as number])
            .filter((v) => !!v);
    }

    private updateSelectedColumnsTarget(_data: React.FormEvent, option: IDropdownOption | undefined) {
        console.log('Updated columns selected', option);

        if (option) {
            if (option.key === -1) {
                // User toggled Select All
                if (option.selected) {
                    // Mark all options as selected
                    this.setColumns(this.generateOptions().map((option) => option.key as number));
                } else {
                    // Unselect all options
                    this.setColumns([]);
                }
            } else {
                // User selected a different option
                const cols = option.selected
                    ? [...this.state.selectedColumns, option.key as number]
                    : // If the user unselected some other option, unselect Select All too
                      this.state.selectedColumns.filter((key) => key !== option.key && key !== -1);

                this.setColumns(cols);
            }
        }
    }

    private setColumns(cols: number[]) {
        if (cols.length === 0) {
            // No columns are selected
            // Removes the operation dropdown for now until another column is selected
            this.setState({ selectedColumns: cols, operationType: null });
        } else if (
            cols.length > 1 &&
            !this.multiSelectColumnOperations.find((operation) => operation === this.state.operationType)
        ) {
            // Removes the operation section because the current operation was a
            // single column operation only and we have more than one column selected
            this.setState({ selectedColumns: cols, operationType: null });
        } else {
            this.setState({ selectedColumns: cols });
        }
    }

    private updateSelectedOperation(_data: React.FormEvent, item: IDropdownOption | undefined) {
        if (item) {
            this.setState({
                operationType: item.text as ColumnOperation
            });
        }
    }
}
