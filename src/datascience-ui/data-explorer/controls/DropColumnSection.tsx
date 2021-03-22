import { Dropdown, IDropdownOption, ResponsiveMode } from '@fluentui/react';
import * as React from 'react';
import { dropdownStyles } from './styles';

interface IProps {
    headers: string[];
    options: IDropdownOption[];
    submitCommand(data: { command: string; args: any }): void;
}

interface IState {
    columnsToDrop: number[]; // Indices
}

export class DropColumnsSection extends React.Component<IProps, IState> {
    constructor(props: IProps) {
        super(props);
        this.state = { columnsToDrop: [] };
    }

    render() {
        return (
            <details
                className="slicing-control"
                style={{
                    borderBottom: '1px solid var(--vscode-editor-inactiveSelectionBackground)',
                    paddingTop: '4px',
                    paddingBottom: '4px'
                }}
            >
                <summary className="slice-summary">
                    <span className="slice-summary-detail">{'DROP COLUMNS'}</span>
                </summary>
                <div className="slice-control-row slice-form-container" style={{ paddingBottom: '5px' }}>
                    <Dropdown
                        responsiveMode={ResponsiveMode.xxxLarge}
                        label={'Column(s) to drop:'}
                        style={{ marginRight: '10px', width: '150px' }}
                        styles={dropdownStyles}
                        multiSelect
                        options={this.props.options}
                        className="dropdownTitleOverrides"
                        onChange={this.updateDropTarget}
                    />
                    <button
                        onClick={() => {
                            this.props.submitCommand({
                                command: 'drop',
                                args: {
                                    targets: this.state.columnsToDrop
                                        .map((v) => this.props.headers[v as number])
                                        .filter((v) => !!v)
                                }
                            });
                            // Clear ourselves after dropping columns
                            this.setState({ columnsToDrop: [] });
                        }}
                        style={{
                            backgroundColor: 'var(--vscode-button-background)',
                            color: 'var(--vscode-button-foreground)',
                            margin: '4px',
                            padding: '4px',
                            border: 'none',
                            cursor: 'pointer',
                            height: '26px',
                            marginTop: '27px',
                            marginLeft: '0px'
                        }}
                    >
                        Drop
                    </button>
                </div>
            </details>
        );
    }

    private updateDropTarget = (_data: React.FormEvent, item: IDropdownOption | undefined) => {
        if (item) {
            this.setState({
                columnsToDrop: item.selected
                    ? [...this.state.columnsToDrop, item.key as number]
                    : this.state.columnsToDrop.filter((key) => key !== item.key)
            });
        }
    };
}
