import { Dropdown, IDropdownOption, ResponsiveMode } from '@fluentui/react';
import * as React from 'react';
import { DropDuplicateRowsSection } from './DropDuplicateRows';
import { DropMissingRowsSection } from './DropMissingRowsSection';
import { dropdownStyles } from './styles';

interface IProps {
    headers: string[];
    options: IDropdownOption[];
    submitCommand(data: { command: string; args: any }): void;
}

interface IState {
    columnsToDrop: number[]; // Indices
	operationType: RowTransformation
}

export enum RowTransformation {
	DropNA = "Drop NA",
    DropDuplicates = "Drop Duplicates"
}

export class RowsSection extends React.Component<IProps, IState> {
    constructor(props: IProps) {
        super(props);
        this.state = { columnsToDrop: [], operationType: RowTransformation.DropNA };
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
                    <span className="slice-summary-detail">{'ROWS'}</span>
                </summary>
                <div className="slice-form-container" style={{ paddingBottom: '5px', marginTop: '10px' }}>
                    <Dropdown
                        responsiveMode={ResponsiveMode.xxxLarge}
                        label={'Operation'}
                        style={{ marginRight: '10px', width: '150px', marginBottom: '16px' }}
                        styles={dropdownStyles}
                        options={this.generateTransformOperations()}
                        className="dropdownTitleOverrides"
                        onChange={this.updateTransformType}
						selectedKey={this.state.operationType}
                    />
                    {this.renderOperationControls()}
                </div>
            </details>
        );
    }

	private renderOperationControls = () => {
		switch (this.state.operationType) {
			case RowTransformation.DropNA:
				return <DropMissingRowsSection headers={this.props.headers} options={this.props.options} submitCommand={this.props.submitCommand} />
            case RowTransformation.DropDuplicates:
                return <DropDuplicateRowsSection headers={this.props.headers} options={this.props.options} submitCommand={this.props.submitCommand} />
		}
	}

	private generateTransformOperations = () => {
		return [
			{
				text: RowTransformation.DropDuplicates,
				key: RowTransformation.DropDuplicates,
			},
			{
				text: RowTransformation.DropNA,
				key: RowTransformation.DropNA,
			}
		];
	}

    private updateTransformType = (_data: React.FormEvent, item: IDropdownOption | undefined) => {
		if (item) {
			this.setState({
				operationType: item.text as RowTransformation
			});
		}
	}
}
