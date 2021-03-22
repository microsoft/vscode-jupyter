import { Dropdown, IDropdownOption, ResponsiveMode } from '@fluentui/react';
import * as React from 'react';
import { dropdownStyles } from './styles';

interface IProps {
    headers: string[];
    options: IDropdownOption[];
    submitCommand(data: { command: string; args: any }): void;
}

interface IState {
    columnRenameTargetText: string | undefined;
    newColumnName: string | undefined;
}

export class RenameColumnsSection extends React.Component<IProps, IState> {
    constructor(props: IProps) {
        super(props);
        this.state = {
            columnRenameTargetText: '',
            newColumnName: ''
        };
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
                    <span className="slice-summary-detail">{'RENAME COLUMNS'}</span>
                </summary>
                <div className="slice-control-row slice-form-container" style={{ paddingBottom: '5px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', width: '100px', paddingTop: '6px' }}>
                        <Dropdown
                            responsiveMode={ResponsiveMode.xxxLarge}
                            label={'Rename column:'}
                            style={{ marginRight: '10px', width: '100px' }}
                            styles={dropdownStyles}
                            selectedKey={this.state.columnRenameTargetText}
                            options={this.props.options}
                            className="dropdownTitleOverrides"
                            onChange={this.updateRenameTarget}
                        />
                        <span>{'To:'}</span>
                        <input
                            value={this.state.newColumnName}
                            onChange={this.handleChange}
                            className={'slice-data'}
                            style={{ width: '100px', marginTop: '4px', marginBottom: '4px' }}
                            autoComplete="on"
                        />
                        <button
                            onClick={() => {
                                if (this.state.newColumnName)
                                    this.props.submitCommand({
                                        command: 'rename',
                                        args: {
                                            old: this.state.columnRenameTargetText,
                                            new: this.state.newColumnName
                                        }
                                    });
                            }}
                            style={{
                                backgroundColor: 'var(--vscode-button-background)',
                                color: 'var(--vscode-button-foreground)',
                                margin: '4px',
                                padding: '4px',
                                border: 'none',
                                cursor: 'pointer',
                                height: '26px'
                            }}
                        >
                            Submit
                        </button>
                    </div>
                </div>
            </details>
        );
    }

    private updateRenameTarget = (_data: React.FormEvent, option: IDropdownOption | undefined) => {
        this.setState({ columnRenameTargetText: option?.text });
    };
    private handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        this.setState({ newColumnName: event.currentTarget.value });
    };
}
