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
    headers: string[];
    options: IDropdownOption[];
    submitCommand(data: { command: string; args: { [key: string]: string | number | boolean| string[] } }): void;
}

interface IState {
    selectedColumns: number[]; // Indices
    operationType: string | null;
    args: { [key: string]: string | number | boolean| string[] | undefined };
}

const columnOperationInfo: { [key: string]: { text: string; tooltip: string; worksWithMultipleCols: boolean } } = {
    Choose: {
        text: 'Choose',
        tooltip: 'Choose an operation',
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
        text: 'Remove Missing Values',
        tooltip: getLocString('DataScience.dataWranglerDropNATooltip', 'Remove missing values from selected columns'),
        worksWithMultipleCols: true
    },
    [DataWranglerCommands.CoerceColumn]: {
        text: 'Coerce',
        tooltip: getLocString('DataScience.dataWranglerCoerceTooltip', 'Cast a column to a specified type'),
        worksWithMultipleCols: true
    },
    [DataWranglerCommands.ReplaceAllColumn]: {
        text: 'Replace All',
        tooltip: getLocString(
            'DataScience.dataWranglerReplaceAllTooltip',
            'Replace specified values with a new given value'
        ),
        worksWithMultipleCols: true
    }
};

const SELECT_TARGET_COLUMNS_OPTION = -2;

export class ColumnsSection extends React.Component<IProps, IState> {
    constructor(props: IProps) {
        super(props);
        this.state = { operationType: null, selectedColumns: [SELECT_TARGET_COLUMNS_OPTION], args: {} };
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
                    options={this.generateOptions()}
                    className="dropdownTitleOverrides"
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
                    defaultSelectedKeys={[SELECT_TARGET_COLUMNS_OPTION]}
                    selectedKey={this.state.operationType}
                />
                {this.state.operationType !== null && columnOperationInfo[this.state.operationType] !== undefined && (
                    <div style={{ color: 'var(--vscode-descriptionForeground)', marginBottom: '4px' }}>
                        <span>{columnOperationInfo[this.state.operationType].tooltip}</span>
                    </div>
                )}
                {this.state.selectedColumns.length > 0 && this.renderOperationControls()}
                <div style={{ display: 'flex', flexDirection: 'row' }}>
                    <button
                        onClick={() => {
                            if (this.state.operationType && this.state.operationType !== 'Choose') {
                                const targetCols = this.getSelectedColumns();
                                this.props.submitCommand({
                                    command: this.state.operationType,
                                    args: {
                                        ...this.state.args,
                                        targetColumn: targetCols[0],
                                        targetColumns: targetCols

                                    }
                                });
                                this.setColumns([]);
                                this.setArgs({});
                                this.setState({operationType: "Choose"});
                            }
                        }}
                        disabled={
                            this.state.operationType === 'Choose' ||
                            !this.state.operationType ||
                            this.state.selectedColumns.includes(SELECT_TARGET_COLUMNS_OPTION) ||
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
                        }}
                        style={clearButtonStyle}
                        className="dataWranglerButton"
                        disabled={
                            (this.state.operationType === 'Choose' || this.state.operationType === null) &&
                            this.state.selectedColumns.includes(SELECT_TARGET_COLUMNS_OPTION)
                        }
                    >
                        Clear
                    </button>
                </div>
            </div>
        );

        return <SidePanelSection title="COLUMNS" panel={columnsComponent} collapsed={this.props.collapsed} />;
    }

    private generateOptions() {
        const selectTargetColumn: IDropdownOption = {
            key: SELECT_TARGET_COLUMNS_OPTION,
            text: 'Select target column',
            disabled: true,
            hidden: true,
            selected: true
        };
        const selectAll = { key: -1, text: 'Select All' };
        // Don't let users operate on index column
        return [
            selectTargetColumn,
            selectAll,
            ...this.props.options.filter((option) => option.text !== 'index' && !option.text.includes('(preview)'))
        ];
    }

    private generatePossibleColumnOperations(): IDropdownOption[] {
        // Possible column operations will depend on amount of selected options
        const chooseOperationOption: IDropdownOption = {
            key: 'Choose',
            text: 'Choose operation',
            disabled: true,
            hidden: true,
            selected: true
        };
        const possibleColumnOperations = [chooseOperationOption];
        const operations = Object.keys(columnOperationInfo).filter((operation) => operation !== 'Choose');

        if (this.state.selectedColumns.length === 0 || this.state.selectedColumns[0] === SELECT_TARGET_COLUMNS_OPTION) {
            // No selected columns. All operations should be disabled.
            operations.forEach((operation) => {
                const option = {
                    key: operation,
                    text: columnOperationInfo[operation].text,
                    disabled: true,
                    title: columnOperationInfo[operation].tooltip
                };
                possibleColumnOperations.push(option);
            });
        } else if (this.state.selectedColumns.length > 1) {
            // Multiple selected columns. Single operations should be disabled.
            operations.forEach((operation) => {
                const option = {
                    key: operation,
                    text: columnOperationInfo[operation].text,
                    disabled: !columnOperationInfo[operation].worksWithMultipleCols,
                    title: columnOperationInfo[operation].tooltip
                };
                possibleColumnOperations.push(option);
            });
        } else {
            // One selected column. No operations should be disabled.
            operations.forEach((operation) => {
                const option = {
                    key: operation,
                    text: columnOperationInfo[operation].text,
                    title: columnOperationInfo[operation].tooltip
                };
                possibleColumnOperations.push(option);
            });
        }

        return possibleColumnOperations;
    }

    private renderOperationControls() {
        switch (this.state.operationType) {
            case DataWranglerCommands.RenameColumn:
                return (
                    <RenameColumnsSection
                        setArgs={this.setArgs.bind(this)}
                    />
                );
            case DataWranglerCommands.NormalizeColumn:
                return (
                    <NormalizeDataSection
                        setArgs={this.setArgs.bind(this)}
                    />
                );
            case DataWranglerCommands.CoerceColumn:
                return (
                    <CoerceColumnsSection
                        setArgs={this.setArgs.bind(this)}
                    />
                );
            case DataWranglerCommands.ReplaceAllColumn:
                return (
                    <ReplaceAllColumnsSection
                        setArgs={this.setArgs.bind(this)}
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
        if (option) {
            if (option.key === -1) {
                // User toggled Select All
                if (option.selected) {
                    // Mark all options as selected
                    this.setColumns(
                        this.generateOptions()
                            .filter((col) => col.key !== SELECT_TARGET_COLUMNS_OPTION)
                            .map((option) => option.key as number)
                    );
                } else {
                    // Unselect all options
                    this.setColumns([]);
                }
            } else {
                // User selected a different option
                const cols = option.selected
                    ? [...this.state.selectedColumns, option.key as number].filter((key) => key >= 0)
                    : // If the user unselected some other option, unselect Select All too
                      this.state.selectedColumns.filter((key) => key !== option.key && key >= 0);

                if (cols.length > 0) {
                    this.setColumns(cols);
                } else {
                    this.setColumns([]);
                }
            }
        }
    }

    private setColumns(cols: number[]) {
        if (cols.length === 0) {
            // No columns are selected
            // Removes the operation dropdown for now until another column is selected
            this.setState({ selectedColumns: [SELECT_TARGET_COLUMNS_OPTION], operationType: 'Choose' });
        } else if (
            cols.length > 1 &&
            this.state.operationType &&
            !columnOperationInfo[this.state.operationType].worksWithMultipleCols
        ) {
            // Deselects the operation because the current operation was a
            // single column operation only and we have more than one column selected
            this.setState({ selectedColumns: cols, operationType: 'Choose' });
        } else {
            this.setState({ selectedColumns: cols });
        }
    }

    private setArgs(args: { [key: string]: string | number | boolean| string[] | undefined }) {
        this.setState({ args: args });
    }

    private updateSelectedOperation(_data: React.FormEvent, item: IDropdownOption | undefined) {
        if (item) {
            const operation = item.key as DataWranglerCommands
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const newState = { operationType:  operation } as any;
            if (operation === DataWranglerCommands.DropNa) {
                newState['args'] = {isPreview: false}
            }
            this.setState(newState);
        }
    }
}
