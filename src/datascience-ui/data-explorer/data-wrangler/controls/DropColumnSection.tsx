import { Dropdown, IDropdownOption, ResponsiveMode } from '@fluentui/react';
import * as React from 'react';
import { dropdownStyles } from './styles';

interface IProps {
    headers: string[];
    options: IDropdownOption[];
    submitCommand(data: { command: string; args: any }): void;
}

interface IState {
    columnsToDrop: number[]; // IDropdownOption keys
}

export class DropColumnsSection extends React.Component<IProps, IState> {
    constructor(props: IProps) {
        super(props);
        this.state = { columnsToDrop: [] };
    }

    render() {
        return (
            // <details
            //     className="slicing-control"
            //     style={{
            //         borderBottom: '1px solid var(--vscode-editor-inactiveSelectionBackground)',
            //         paddingTop: '4px',
            //         paddingBottom: '4px'
            //     }}
            // >
            //     <summary className="slice-summary">
            //         <span className="slice-summary-detail">{'DROP COLUMNS'}</span>
            //     </summary>
            <div className="slice-control-row" style={{ paddingBottom: '5px' }}>
                <Dropdown
                    responsiveMode={ResponsiveMode.xxxLarge}
                    label={'Column(s) to drop:'}
                    style={{ marginRight: '10px', width: '150px' }}
                    styles={dropdownStyles}
                    multiSelect
                    selectedKeys={this.state.columnsToDrop}
                    options={this.generateOptions()}
                    className="dropdownTitleOverrides"
                    onChange={this.updateDropTarget}
                />
                <button
                    onClick={() => {
                        this.props.submitCommand({
                            command: 'drop',
                            args: {
                                targets: this.state.columnsToDrop
                                    .filter((v) => v !== -1)
                                    .map((v) => this.props.headers[v as number])
                                    .filter((v) => !!v)
                            }
                        });
                        // Clear ourselves after dropping columns
                        this.setState({ columnsToDrop: [] });
                    }}
                    style={{
                        // width: '50px',
                        backgroundColor: 'var(--vscode-button-background)',
                        color: 'var(--vscode-button-foreground)',
                        margin: '4px',
                        padding: '8px',
                        border: 'none',
                        cursor: 'pointer',
                        height: '26px',
                        marginTop: '22px',
                        marginLeft: '0px'
                    }}
                >
                    Drop
                </button>
            </div>
            // </details>
        );
    }

    private generateOptions() {
        const selectAll = { key: -1, text: 'Select All' };
        return [selectAll, ...this.props.options.filter((option) => option.text !== 'index')]; // Don't let user drop the index column
    }

    private updateDropTarget = (_data: React.FormEvent, item: IDropdownOption | undefined) => {
        if (item) {
            if (item.key === -1) {
                // User toggled Select All
                if (item.selected) {
                    // Mark all options as selected
                    this.setState({ columnsToDrop: this.generateOptions().map((option) => option.key as number) });
                } else {
                    // Unselect all options
                    this.setState({ columnsToDrop: [] });
                }
            } else {
                this.setState({
                    columnsToDrop: item.selected
                        ? [...this.state.columnsToDrop, item.key as number]
                        : // If the user unselected some other item, unselect Select All too
                          this.state.columnsToDrop.filter((key) => key !== item.key && key !== -1)
                });
            }
        }
    };
}
