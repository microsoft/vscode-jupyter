import { Dropdown, IDropdownOption, ResponsiveMode } from '@fluentui/react';
import * as React from 'react';
import { DataWranglerCommands } from '../../../../../client/datascience/data-viewing/data-wrangler/types';
import { dropdownStyles } from '../styles';

interface IProps {
    headers: string[];
    options: IDropdownOption[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    submitCommand(data: { command: string; args: any }): void;
}

interface IState {
    columnCoerceTargetKey: number | undefined;
    columnCoerceTargetText: string | undefined;
    newColumnType: string | undefined;
}

export class CoerceColumnsSection extends React.Component<IProps, IState> {
    constructor(props: IProps) {
        super(props);
        this.state = {
            columnCoerceTargetKey: 1,
            columnCoerceTargetText: '',
            newColumnType: ''
        };
    }

    render() {
        return (
            <div className="slice-control-row" style={{ paddingBottom: '5px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', width: '100px' }}>
                    <Dropdown
                        responsiveMode={ResponsiveMode.xxxLarge}
                        label={'Coerce column:'}
                        style={{ marginRight: '10px', width: '150px', marginBottom: '16px' }}
                        styles={dropdownStyles}
                        options={this.props.options}
                        className="dropdownTitleOverrides"
                        onChange={this.updateRenameTarget}
                    />
                    <span>{'To:'}</span>
                    <input
                        value={this.state.newColumnType}
                        onChange={this.handleChange}
                        className={'slice-data'}
                        style={{ width: '140px', marginTop: '4px', marginBottom: '16px' }}
                        autoComplete="on"
                    />
                    <button
                        onClick={() => {
                            if (this.state.newColumnType) {
                                this.props.submitCommand({
                                    command: DataWranglerCommands.CoerceColumn,
                                    args: {
                                        columnName: this.state.columnCoerceTargetText,
                                        newType: this.state.newColumnType
                                    }
                                });
                            }
                        }}
                        style={{
                            backgroundColor: 'var(--vscode-button-background)',
                            color: 'var(--vscode-button-foreground)',
                            margin: '4px',
                            marginLeft: '0px',
                            padding: '8px',
                            border: 'none',
                            cursor: 'pointer',
                            height: '26px'
                        }}
                    >
                        Submit
                    </button>
                </div>
            </div>
        );
    }

    private updateRenameTarget = (_data: React.FormEvent, option: IDropdownOption | undefined) => {
        console.log('Update coerce target', option);
        this.setState({ columnCoerceTargetKey: option?.key as number, columnCoerceTargetText: option?.text });
    };
    private handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        this.setState({ newColumnType: event.currentTarget.value });
    };
}
