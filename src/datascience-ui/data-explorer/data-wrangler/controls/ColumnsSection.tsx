import { Dropdown, IDropdownOption, ResponsiveMode } from '@fluentui/react';
import * as React from 'react';
import { getLocString } from '../../../react-common/locReactSide';
import { CoerceColumnsSection } from './column-operations/CoerceColumnsSection';
import { NormalizeDataSection } from './column-operations/NormalizeDataSection';
import { RenameColumnsSection } from './column-operations/RenameColumnsSection';
import { ReplaceAllColumnsSection } from './column-operations/ReplaceAllColumnsSection';
import { FillNaSection } from './column-operations/FillNaSection';
import { SidePanelSection } from './SidePanelSection';
import { clearButtonStyle, dropdownStyle, dropdownStyles } from './styles';
import '../controlPanel.css';
import { DataWranglerCommands } from '../../../../client/datascience/data-viewing/data-wrangler/types';

interface IProps {
    collapsed: boolean;
    options: IDropdownOption[];
    submitCommand(data: { command: string; args: { [key: string]: string | number | boolean | string[] } }): void;
    primarySelectedColumn?: string;
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
        text: getLocString('DataScience.dataWranglerDrop', 'Drop'),
        tooltip: getLocString('DataScience.dataWranglerDropTooltip', 'Drop specified labels from selected columns'),
        worksWithMultipleCols: true
    },
    [DataWranglerCommands.RenameColumn]: {
        text: getLocString('DataScience.dataWranglerRename', 'Rename'),
        tooltip: getLocString('DataScience.dataWranglerRenameTooltip', 'Rename column label'),
        worksWithMultipleCols: false
    },
    [DataWranglerCommands.NormalizeColumn]: {
        text: getLocString('DataScience.dataWranglerNormalize', 'Normalize'),
        tooltip: getLocString(
            'DataScience.dataWranglerNormalizeTooltip',
            'Transform column by scaling each feature to a given range'
        ),
        worksWithMultipleCols: false
    },
    [DataWranglerCommands.DropNa]: {
        text: getLocString('DataScience.dataWranglerDropNa', 'Remove Missing Values'),
        tooltip: getLocString('DataScience.dataWranglerDropNATooltip', 'Remove missing values from selected columns'),
        worksWithMultipleCols: true
    },
    [DataWranglerCommands.FillNa]: {
        text: getLocString('DataScience.dataWranglerFillNa', 'Replace Missing Values'),
        tooltip: getLocString('DataScience.dataWranglerFillNaTooltip', 'Replace missing values from selected columns'),
        worksWithMultipleCols: true
    },
    [DataWranglerCommands.CoerceColumn]: {
        text: getLocString('DataScience.dataWranglerCoerce', 'Coerce'),
        tooltip: getLocString('DataScience.dataWranglerCoerceTooltip', 'Cast a column to a specified type'),
        worksWithMultipleCols: true
    },
    [DataWranglerCommands.ReplaceAllColumn]: {
        text: getLocString('DataScience.dataWranglerReplaceAll', 'Replace All'),
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
        const applyButton = (
            <button
                onClick={() => {
                    this.props.submitCommand({
                        command: this.state.operationType!,
                        args: {
                            ...this.state.args,
                            targetColumn: this.props.selectedColumns[0],
                            targetColumns: this.props.selectedColumns
                        }
                    });
                    this.clearSelection();
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
                {getLocString('DataScience.dataWranglerApply', 'Apply')}
            </button>
        );

        const clearButton = (
            <button
                onClick={this.clearSelection}
                style={clearButtonStyle}
                className="dataWranglerButton"
                disabled={
                    (this.state.operationType === NON_SELECTABLE_OPTIONS.ChooseOperation ||
                        this.state.operationType === null) &&
                    this.props.selectedColumns.length === 0
                }
            >
                {getLocString('DataScience.dataWranglerClear', 'Clear')}
            </button>
        );

        const columnsComponent = (
            <div className="slice-form-container" style={{ paddingBottom: '5px', marginTop: '10px' }}>
                <Dropdown
                    multiSelect={true}
                    responsiveMode={ResponsiveMode.xxxLarge}
                    label={getLocString('DataScience.dataWranglerTargetColumns', 'Target column(s)')}
                    style={dropdownStyle}
                    styles={dropdownStyles}
                    options={this.generateColumnOptions()}
                    className="dropdownTitleOverrides"
                    onChange={this.updateSelectedColumnsTarget.bind(this)}
                    selectedKeys={this.handleColumnSelection()}
                />
                <Dropdown
                    responsiveMode={ResponsiveMode.xxxLarge}
                    label={getLocString('DataScience.dataWranglerOperations', 'Operation')}
                    style={dropdownStyle}
                    styles={dropdownStyles}
                    options={this.generateOperationOptions()}
                    className="dropdownTitleOverrides"
                    onChange={this.updateSelectedOperation.bind(this)}
                    selectedKey={this.state.operationType}
                />
                {/* Show operation description if operation is selected */}
                {this.state.operationType && ColumnOperationInfo[this.state.operationType] && (
                    <div style={{ color: 'var(--vscode-descriptionForeground)', marginBottom: '4px' }}>
                        <span>{ColumnOperationInfo[this.state.operationType].tooltip}</span>
                    </div>
                )}
                {/* Show specific column operation if a column is selected */}
                {this.props.selectedColumns.length > 0 && (
                    <div className="slice-control-row column-operation-section">
                        <div className="inner">{this.renderOperationControls()}</div>
                    </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'row' }}>
                    {applyButton}
                    {clearButton}
                </div>
            </div>
        );

        return (
            <SidePanelSection
                title={getLocString('DataScience.dataWranglerPanelColumns', 'COLUMNS')}
                panel={columnsComponent}
                collapsed={this.props.collapsed}
                height={'220px'}
            />
        );
    }

    private generateColumnOptions() {
        const selectTargetColumn: IDropdownOption = {
            key: NON_SELECTABLE_OPTIONS.SelectTargetsColumn,
            text: getLocString('DataScience.dataWranglerSelectTargetColumns', 'Select target column(s)'),
            disabled: true,
            hidden: true,
            selected: true
        };
        // Don't let users operate on index columns or preview columns
        return [
            selectTargetColumn,
            ...this.props.options.filter(
                (option) => option.text && option.text !== 'index' && option.text !== 'No.' && !option.text.includes('(preview)')
            )
        ];
    }

    private generateOperationOptions(): IDropdownOption[] {
        // Possible operations will depend on amount of selected options

        // Create 'Choose operation' operation so text will show up in dropdown by default but can't be selected
        const chooseOperationOption: IDropdownOption = {
            key: NON_SELECTABLE_OPTIONS.ChooseOperation,
            text: getLocString('DataScience.dataWranglerChooseOperation', 'Choose Operation'),
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
            case DataWranglerCommands.FillNa:
                return <FillNaSection setArgs={this.setArgs.bind(this)} />;
            default:
                return <></>;
        }
    }

    private updateSelectedColumnsTarget(_data: React.FormEvent, option: IDropdownOption | undefined) {
        if (option) {
            const cols = option.selected
                ? // User selected an option so add it to selected columns
                  [...this.props.selectedColumns, option.key as string].filter(
                      (key) => key !== NON_SELECTABLE_OPTIONS.SelectTargetsColumn
                  )
                : // User unselected an option so remove it from selected columns
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
            this.props.setSelectedColumns([], undefined);
            this.setState({ operationType: NON_SELECTABLE_OPTIONS.ChooseOperation });
        } else if (
            cols.length > 1 &&
            this.state.operationType &&
            !ColumnOperationInfo[this.state.operationType].worksWithMultipleCols
        ) {
            // Deselects the operation because the current operation was a
            // single column operation only and we have more than one column selected

            // If current primary selected column is deselected, then there should be no primary selected column
            const primarySelectedColumn =
                this.props.primarySelectedColumn && cols.includes(this.props.primarySelectedColumn)
                    ? this.props.primarySelectedColumn
                    : undefined;
            this.props.setSelectedColumns(cols, primarySelectedColumn);
            this.setState({ operationType: NON_SELECTABLE_OPTIONS.ChooseOperation });
        } else {
            this.props.setSelectedColumns(cols, cols[0]);
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

            // These commands do not have their own component so we set their args here
            if ([DataWranglerCommands.DropNa].includes(operation)) {
                newState['args'] = { isPreview: false };
            } else if ([DataWranglerCommands.Drop].includes(operation)) {
                newState['args'] = {};
            }

            this.setState(newState);
        }
    }

    // If nothing is selected, select "Select target column(s)" option so it shows up in the dropdown field
    private handleColumnSelection() {
        return this.props.selectedColumns.length === 0
            ? [NON_SELECTABLE_OPTIONS.SelectTargetsColumn]
            : this.props.selectedColumns;
    }

    private clearSelection() {
        this.setColumns([]);
        this.props.setSelectedRows([]);
        this.setArgs({});
        this.setState({ operationType: NON_SELECTABLE_OPTIONS.ChooseOperation });
    }
}
