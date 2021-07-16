import { Dropdown, IDropdownOption, ResponsiveMode } from '@fluentui/react';
import * as React from 'react';
import { DataWranglerCommands } from '../../../../client/datascience/data-viewing/data-wrangler/types';
import { getLocString } from '../../../react-common/locReactSide';
import { SidePanelSection } from './SidePanelSection';
import { clearButtonStyle, dropdownStyle, dropdownStyles } from './styles';

interface IProps {
    collapsed: boolean;
    options: IDropdownOption[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    submitCommand(data: { command: string; args: any }): void;
    setSelectedColumns(selectedColumns: string[], primarySelectedColumn?: string | undefined): void;
    setSelectedRows(selectedRows: number[], primarySelectedRow?: number | undefined): void;
}

interface IState {
    operationType: string;
    args: { [key: string]: string | number | boolean | string[] };
}

const rowOperationInfo: { [key: string]: { text: string; tooltip: string } } = {
    Choose: {
        text: 'Choose operation',
        tooltip: ''
    },
    [DataWranglerCommands.DropNa]: {
        text: 'Drop missing values',
        tooltip: getLocString('DataScience.dataWranglerDropNARowsTooltip', 'Remove rows with missing values')
    },
    [DataWranglerCommands.DropDuplicates]: {
        text: 'Drop duplicates',
        tooltip: getLocString('DataScience.dataWranglerDropDuplicateRowsTooltip', 'Remove duplicate rows')
    }
};

const ChooseOperation = 'Choose';

export class RowsSection extends React.Component<IProps, IState> {
    constructor(props: IProps) {
        super(props);
        this.state = { operationType: ChooseOperation, args: {} };
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
                    onChange={this.updateOperationType}
                    selectedKey={this.state.operationType}
                />
                {this.state.operationType && (
                    <div style={{ color: 'var(--vscode-descriptionForeground)', marginBottom: '4px' }}>
                        <span>{rowOperationInfo[this.state.operationType].tooltip}</span>
                    </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'row' }}>
                    <button
                        onClick={() => {
                            this.props.submitCommand({
                                command: this.state.operationType,
                                args: {
                                    ...this.state.args
                                }
                            });
                            this.setState({ operationType: ChooseOperation }, () => {
                                this.props.setSelectedColumns([]);
                                this.props.setSelectedRows([]);
                            });
                        }}
                        disabled={this.state.operationType === ChooseOperation}
                        className="dataWranglerButton"
                    >
                        Apply
                    </button>
                    <button
                        onClick={() => {
                            this.setState({ operationType: ChooseOperation });
                        }}
                        style={clearButtonStyle}
                        className="dataWranglerButton"
                        disabled={this.state.operationType === ChooseOperation}
                    >
                        Clear
                    </button>
                </div>
            </div>
        );

        return (
            <SidePanelSection title="ROWS" panel={rowsComponent} collapsed={this.props.collapsed} height={'120px'} />
        );
    }

    private generateTransformOperations = () => {
        return Object.keys(rowOperationInfo).map((operation) => {
            const option: IDropdownOption = {
                text: rowOperationInfo[operation].text,
                key: operation,
                title: rowOperationInfo[operation].tooltip
            };
            if (operation === ChooseOperation) {
                option['disabled'] = true;
                option['hidden'] = true;
                option['selected'] = true;
            }
            return option;
        });
    };

    private updateOperationType = (_data: React.FormEvent, item: IDropdownOption | undefined) => {
        if (item) {
            const operation = item.key as DataWranglerCommands;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const newState = { operationType: operation } as any;
            if (operation === DataWranglerCommands.DropNa) {
                newState['args'] = { target: 'row', isPreview: true };
            }
            this.setState(newState);
        }
    };
}
