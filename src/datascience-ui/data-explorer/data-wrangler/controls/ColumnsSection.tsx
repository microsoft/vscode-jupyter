import { Dropdown, IDropdownOption, ResponsiveMode } from '@fluentui/react';
import * as React from 'react';
import { getLocString } from '../../../react-common/locReactSide';
import { CoerceColumnsSection } from './column-operations/CoerceColumnsSection';
import { DropColumnsSection } from './column-operations/DropColumnSection';
import { DropMissingColumnsSection } from './column-operations/DropMissingColumnsSection';
import { NormalizeDataSection } from './column-operations/NormalizeDataSection';
import { RenameColumnsSection } from './column-operations/RenameColumnsSection';
import { ReplaceAllColumnsSection } from './column-operations/ReplaceAllColumnsSection';
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

interface IColumnOperationInfo {
    title: ColumnOperation,
    tooltip: string,
    worksWithMultipleCols: boolean
}

const columnOperationInfo: Array<IColumnOperationInfo> = [
    {
        title: ColumnOperation.Drop,
        tooltip: getLocString('DataScience.dataWranglerDropTooltip', 'Drop specified labels from selected columns'),
        worksWithMultipleCols: true
    },
    {
        title: ColumnOperation.Rename,
        tooltip: getLocString('DataScience.dataWranglerRenameTooltip', 'Rename column label'),
        worksWithMultipleCols: false
    },
    {
        title: ColumnOperation.Normalize,
        tooltip: getLocString('DataScience.dataWranglerNormalizeTooltip', 'Transform column by scaling each feature to a given range'),
        worksWithMultipleCols: false
    },
    {
        title: ColumnOperation.DropNA,
        tooltip: getLocString('DataScience.dataWranglerDropNATooltip', 'Remove missing values from selected columns'),
        worksWithMultipleCols: true
    },
    {
        title: ColumnOperation.Coerce,
        tooltip: getLocString('DataScience.dataWranglerCoerceTooltip', 'Cast a column to a specified type'),
        worksWithMultipleCols: true
    },
    {
        title: ColumnOperation.ReplaceAll,
        tooltip: getLocString('DataScience.dataWranglerReplaceAllTooltip', 'Replace specified values with a new given value'),
        worksWithMultipleCols: true
    }
];

export class ColumnsSection extends React.Component<IProps, IState> {
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
                    style={dropdownStyle}
                    styles={dropdownStyles}
                    options={this.generateOptions()}
                    className="dropdownTitleOverrides "
                    onChange={this.updateSelectedColumnsTarget.bind(this)}
                    selectedKeys={this.state.selectedColumns}
                />
                <Dropdown
                    responsiveMode={ResponsiveMode.xxxLarge}
                    label={'Operation'}
                    style={dropdownStyle}
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
            for (const operation of Object.values(columnOperationInfo)) {
                const option = {
                    key: operation.title,
                    text: operation.title,
                    disabled: true,
                    title: operation.tooltip
                };
                possibleColumnOperations.push(option);
            }
        } else if (this.state.selectedColumns.length > 1) {
            // Multiple selected columns. Single operations should be disabled.
            for (const operation of Object.values(columnOperationInfo)) {
                const option = {
                    key: operation.title,
                    text: operation.title,
                    disabled: !operation.worksWithMultipleCols,
                    title: operation.tooltip
                };
                possibleColumnOperations.push(option);
            }
        } else {
            // One selected column. No operations should be disabled.
            for (const operation of Object.values(columnOperationInfo)) {
                const option = { key: operation.title, text: operation.title, title: operation.tooltip };
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
            cols.length > 1 && this.state.operationType && !columnOperationInfo.filter(op => this.state.operationType === op.title)[0].worksWithMultipleCols
        ) {
            // Deselects the operation because the current operation was a
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
