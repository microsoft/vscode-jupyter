import { Dropdown, IDropdownOption, ResponsiveMode } from '@fluentui/react';
import * as React from 'react';
import { getLocString } from '../../../react-common/locReactSide';
import { CoerceColumnsSection } from './column-operations/CoerceColumnsSection';
import { NormalizeDataSection } from './column-operations/NormalizeDataSection';
import { RenameColumnsSection } from './column-operations/RenameColumnsSection';
import { ReplaceAllColumnsSection } from './column-operations/ReplaceAllColumnsSection';
import { SidePanelSection } from './SidePanelSection';
import { clearButtonStyle, dropdownStyle, dropdownStyles } from './styles';
import '../controlPanel.css';
import { DataWranglerCommands } from '../../../../client/datascience/data-viewing/data-wrangler/types';

interface IProps {
    collapsed: boolean;
    options: IDropdownOption[];
    submitCommand(data: { command: string; args: { [key: string]: string | number | boolean | string[] } }): void;
    selectedColumns: string[];
    setSelectedColumns(selectedColumns: string[], primarySelectedColumn?: string | undefined): void;
    setSelectedRows(selectedRows: number[], primarySelectedRow?: number | undefined): void;
}

interface IState {
    operationType: string | null;
    args: { [key: string]: string | number | boolean | string[] | undefined };
}

// Options in dropdowns that show up but can not perform actions on them
const NON_SELECTABLE_OPTIONS = {
    SelectTargetsColumn: 'select_target_columns',
    ChooseOperation: 'choose'
};

const ColumnOperationInfo: { [key: string]: { text: string; tooltip: string; worksWithMultipleCols: boolean } } = {
    [NON_SELECTABLE_OPTIONS.ChooseOperation]: {
        text: NON_SELECTABLE_OPTIONS.ChooseOperation,
        tooltip: '',
        worksWithMultipleCols: false
    },
    [DataWranglerCommands.Drop]: {
        text: 'Drop',
        tooltip: getLocString('DataScience.dataWranglerDropTooltip', 'Drop specified labels from selected columns'),
        worksWithMultipleCols: true
    },
    [DataWranglerCommands.RenameColumn]: {
        text: 'Rename',
        tooltip: getLocString('DataScience.dataWranglerRenameTooltip', 'Rename column label'),
        worksWithMultipleCols: false
    },
    [DataWranglerCommands.NormalizeColumn]: {
        text: 'Normalize',
        tooltip: getLocString(
            'DataScience.dataWranglerNormalizeTooltip',
            'Transform column by scaling each feature to a given range'
        ),
        worksWithMultipleCols: false
    },
    [DataWranglerCommands.DropNa]: {
        text: 'Remove missing values',
        tooltip: getLocString('DataScience.dataWranglerDropNATooltip', 'Remove missing values from selected columns'),
        worksWithMultipleCols: true
    },
    [DataWranglerCommands.CoerceColumn]: {
        text: 'Coerce',
        tooltip: getLocString('DataScience.dataWranglerCoerceTooltip', 'Cast a column to a specified type'),
        worksWithMultipleCols: true
    },
    [DataWranglerCommands.ReplaceAllColumn]: {
        text: 'Replace all',
        tooltip: getLocString(
            'DataScience.dataWranglerReplaceAllTooltip',
            'Replace specified values with a new given value'
        ),
        worksWithMultipleCols: true
    }
};

export class ColumnsSection extends React.Component<IProps, IState> {
    constructor(props: IProps) {
        super(props);
        this.state = { operationType: NON_SELECTABLE_OPTIONS.ChooseOperation, args: {} };
    }

    render() {
        const columnsComponent = (
            <div className="slice-form-container" style={{ paddingBottom: '5px', marginTop: '10px' }}>
                <Dropdown
                    multiSelect={true}
                    responsiveMode={ResponsiveMode.xxxLarge}
                    label={'Target column(s)'}
                    style={dropdownStyle}
                    styles={dropdownStyles}
                    options={this.generateColumnOptions()}
                    className="dropdownTitleOverrides"
                    onChange={this.updateSelectedColumnsTarget.bind(this)}
                    selectedKeys={this.handleColumnSelection()}
                />
                <Dropdown
                    responsiveMode={ResponsiveMode.xxxLarge}
                    label={'Operation'}
                    style={dropdownStyle}
                    styles={dropdownStyles}
                    options={this.generateOperationOptions()}
                    className="dropdownTitleOverrides"
                    onChange={this.updateSelectedOperation.bind(this)}
                    selectedKey={this.state.operationType}
                />
                {this.state.operationType !== null && ColumnOperationInfo[this.state.operationType] !== undefined && (
                    <div style={{ color: 'var(--vscode-descriptionForeground)', marginBottom: '4px' }}>
                        <span>{ColumnOperationInfo[this.state.operationType].tooltip}</span>
                    </div>
                )}
                {this.props.selectedColumns.length > 0 && this.renderOperationControls()}
                <div style={{ display: 'flex', flexDirection: 'row' }}>
                    <button
                        onClick={() => {
                            if (
                                this.state.operationType &&
                                this.state.operationType !== NON_SELECTABLE_OPTIONS.ChooseOperation
                            ) {
                                this.props.submitCommand({
                                    command: this.state.operationType,
                                    args: {
                                        ...this.state.args,
                                        targetColumn: this.props.selectedColumns[0],
                                        targetColumns: this.props.selectedColumns
                                    }
                                });
                                this.setColumns([]);
                                this.props.setSelectedRows([]);
                                this.setArgs({});
                                this.setState({ operationType: NON_SELECTABLE_OPTIONS.ChooseOperation });
                            }
                        }}
                        disabled={
                            this.state.operationType === NON_SELECTABLE_OPTIONS.ChooseOperation ||
                            !this.state.operationType ||
                            this.props.selectedColumns.includes(NON_SELECTABLE_OPTIONS.SelectTargetsColumn) ||
                            Object.values(this.state.args).includes('') ||
                            Object.values(this.state.args).includes(NaN)
                        }
                        className="dataWranglerButton"
                    >
                        Apply
                    </button>
                    <button
                        onClick={() => {
                            this.setColumns([]);
                            this.props.setSelectedRows([]);
                        }}
                        style={clearButtonStyle}
                        className="dataWranglerButton"
                        disabled={
                            (this.state.operationType === NON_SELECTABLE_OPTIONS.ChooseOperation ||
                                this.state.operationType === null) &&
                            this.props.selectedColumns.length === 0
                        }
                    >
                        Clear
                    </button>
                </div>
            </div>
        );

        return <SidePanelSection title="COLUMNS" panel={columnsComponent} collapsed={this.props.collapsed}  height={"220px"}/>;
    }

    private generateColumnOptions() {
        const selectTargetColumn: IDropdownOption = {
            key: NON_SELECTABLE_OPTIONS.SelectTargetsColumn,
            text: 'Select target column(s)',
            disabled: true,
            hidden: true,
            selected: true
        };
        // Don't let users operate on index columns or preview columns
        return [
            selectTargetColumn,
            ...this.props.options.filter(
                (option) => option.text && option.text !== 'index' && !option.text.includes('(preview)')
            )
        ];
    }

    private generateOperationOptions(): IDropdownOption[] {
        // Possible operations will depend on amount of selected options

        // Create 'Choose operation' operation so text will show up in dropdown by default but can't be selected
        const chooseOperationOption: IDropdownOption = {
            key: NON_SELECTABLE_OPTIONS.ChooseOperation,
            text: 'Choose operation',
            disabled: true,
            hidden: true,
            selected: true
        };
        const possibleColumnOperations = [chooseOperationOption];

        // Get all operations
        const operations = Object.keys(ColumnOperationInfo).filter(
            (operation) => operation !== NON_SELECTABLE_OPTIONS.ChooseOperation
        );

        if (this.props.selectedColumns.length === 0) {
            // No selected columns. All operations should be disabled.
            operations.forEach((operation) => {
                const option = {
                    key: operation,
                    text: ColumnOperationInfo[operation].text,
                    disabled: true,
                    title: ColumnOperationInfo[operation].tooltip
                };
                possibleColumnOperations.push(option);
            });
        } else if (this.props.selectedColumns.length > 1) {
            // Multiple selected columns. Operations that only work with one column should be disabled.
            operations.forEach((operation) => {
                const option = {
                    key: operation,
                    text: ColumnOperationInfo[operation].text,
                    disabled: !ColumnOperationInfo[operation].worksWithMultipleCols,
                    title: ColumnOperationInfo[operation].tooltip
                };
                possibleColumnOperations.push(option);
            });
        } else {
            // One selected column. No operations should be disabled.
            operations.forEach((operation) => {
                const option = {
                    key: operation,
                    text: ColumnOperationInfo[operation].text,
                    title: ColumnOperationInfo[operation].tooltip
                };
                possibleColumnOperations.push(option);
            });
        }

        return possibleColumnOperations;
    }

    private renderOperationControls() {
        switch (this.state.operationType) {
            case DataWranglerCommands.RenameColumn:
                return <RenameColumnsSection setArgs={this.setArgs.bind(this)} />;
            case DataWranglerCommands.NormalizeColumn:
                return <NormalizeDataSection setArgs={this.setArgs.bind(this)} />;
            case DataWranglerCommands.CoerceColumn:
                return <CoerceColumnsSection setArgs={this.setArgs.bind(this)} />;
            case DataWranglerCommands.ReplaceAllColumn:
                return <ReplaceAllColumnsSection setArgs={this.setArgs.bind(this)} />;
            default:
                return <></>;
        }
    }

    private updateSelectedColumnsTarget(_data: React.FormEvent, option: IDropdownOption | undefined) {
        if (option) {
            const cols = option.selected
                ? // User selected an option
                  [...this.props.selectedColumns, option.key as string].filter(
                      (key) => key !== NON_SELECTABLE_OPTIONS.SelectTargetsColumn
                  )
                : // User unselected an option
                  this.props.selectedColumns.filter(
                      (key) => key !== option.key && key !== NON_SELECTABLE_OPTIONS.SelectTargetsColumn
                  );

            if (cols.length > 0) {
                this.setColumns(cols);
            } else {
                this.setColumns([]);
            }
        }
    }

    /**
     * Actually sets the selected columns in React Slick Grid through passed down props function
     * Also changes the operation if necessary
     */
    private setColumns(cols: string[]) {
        if (cols.length === 0) {
            // No columns are selected
            // Resets the operation dropdown for now until another column is selected
            this.props.setSelectedColumns([]);
            this.setState({ operationType: NON_SELECTABLE_OPTIONS.ChooseOperation });
        } else if (
            cols.length > 1 &&
            this.state.operationType &&
            !ColumnOperationInfo[this.state.operationType].worksWithMultipleCols
        ) {
            // Deselects the operation because the current operation was a
            // single column operation only and we have more than one column selected
            this.props.setSelectedColumns(cols);
            this.setState({ operationType: NON_SELECTABLE_OPTIONS.ChooseOperation });
        } else {
            this.props.setSelectedColumns(cols);
        }
    }

    private setArgs(args: { [key: string]: string | number | boolean | string[] | undefined }) {
        this.setState({ args: args });
    }

    private updateSelectedOperation(_data: React.FormEvent, item: IDropdownOption | undefined) {
        if (item) {
            const operation = item.key as DataWranglerCommands;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const newState = { operationType: operation } as any;
            if (operation === DataWranglerCommands.DropNa) {
                newState['args'] = { isPreview: false };
            }
            this.setState(newState);
        }
    }

    // If nothing is selected, select "Select target column(s)" option so it shows up in the dropdown field
    private handleColumnSelection() {
        return this.props.selectedColumns.length === 0 ? [NON_SELECTABLE_OPTIONS.SelectTargetsColumn] : this.props.selectedColumns;
    }
}
