import { Dropdown, IDropdownOption, ResponsiveMode, TextField } from '@fluentui/react';
import * as React from 'react';
import { IGetSliceRequest } from '../../client/datascience/data-viewing/types';

import './sliceControl.css';

const sliceRegEx = /^\s*((?<StartRange>-?\d+:)|(?<StopRange>-?:\d+)|(?:(?<Start>-?\d+)(?::(?<Stop>-?\d+))?(?::(?<Step>-?\d+))?))\s*$/;
// These styles are passed to the FluentUI dropdown controls
const textFieldStyles = {
    errorMessage: {
        border: '1px solid var(--vscode-inputValidation-errorBorder)',
        backgroundColor: 'var(--vscode-inputValidation-errorBackground)',
        color: 'var(--vscode-settings-textInputForeground)',
        alignItems: 'center',
        padding: '5px 3px',
        fontFamily: 'var(--vscode-font-family)',
        fontWeight: 'var(--vscode-font-weight)',
        fontSize: 'var(--vscode-font-size)'
    },
    fieldGroup: {
        background: 'none',
        '::after': {
            inset: 'none',
            border: 'none'
        }
    }
};
const styleOverrides = {
    color: 'var(--vscode-dropdown-foreground)',
    backgroundColor: 'var(--vscode-dropdown-background)',
    fontFamily: 'var(--vscode-font-family)',
    fontWeight: 'var(--vscode-font-weight)',
    fontSize: 'var(--vscode-font-size)',
    ':focus': {
        color: 'var(--vscode-dropdown-foreground)'
    },
    ':active': {
        color: 'var(--vscode-dropdown-foreground)'
    },
    ':hover': {
        color: 'var(--vscode-dropdown-foreground)',
        backgroundColor: 'var(--vscode-dropdown-background)'
    }
};
const dropdownStyles = {
    root: {
        color: 'var(--vscode-dropdown-foreground)'
    },
    dropdown: {
        width: 50, // TODO this should change based on the length of the longest option
    },
    dropdownItems: { 
        ...styleOverrides,
        selectors: {
            "@media(min-width: 300px)": {
              maxHeight: 100
            }
        }
    },
    callout: styleOverrides,
    dropdownItem: styleOverrides,
    dropdownItemSelected: styleOverrides,
    dropdownItemDisabled: {
        color: 'var(--vscode-dropdown-foreground)',
        fontFamily: 'var(--vscode-font-family)',
        fontWeight: 'var(--vscode-font-weight)',
        fontSize: 'var(--vscode-font-size)',
        backgroundColor: 'var(--vscode-dropdown-background)',
        opacity: '0.3'
    },
    dropdownItemSelectedAndDisabled: {
        color: 'var(--vscode-dropdown-foreground)',
        fontFamily: 'var(--vscode-font-family)',
        fontWeight: 'var(--vscode-font-weight)',
        fontSize: 'var(--vscode-font-size)',
        backgroundColor: 'var(--vscode-dropdown-background)',
        opacity: '0.3'
    }
};

interface ISliceControlProps {
    loadingData: boolean;
    originalVariableShape: number[];
    handleSliceRequest(slice: IGetSliceRequest): void;
}

interface ISliceControlState {
    sliceExpression: string;
    inputValue: string;
    isEnabled: boolean;
    [key: string]: number | boolean | string;
}

export class SliceControl extends React.Component<ISliceControlProps, ISliceControlState> {
    constructor(props: ISliceControlProps) {
        super(props);
        const initialSlice = this.preselectedSliceExpression();
        this.state = { isEnabled: false, sliceExpression: initialSlice, inputValue: initialSlice };

        this.handleChange = this.handleChange.bind(this);
        this.handleSubmit = this.handleSubmit.bind(this);
    }

    public componentDidUpdate(prevProps: ISliceControlProps) {
        if (this.props.originalVariableShape !== prevProps.originalVariableShape) {
            let slice = this.preselectedSliceExpression();
            if (this.state.isEnabled) {
                if (this.validateSliceExpression(this.state.sliceExpression) === '') {
                    // Check if the current slice expression would be valid relative to the new shape
                    // If it would still be valid, use that instead of the preselected one
                    slice = this.state.sliceExpression;
                }
            } else {
                // Slicing not enabled anyway, so no slice
                slice = this.fullSliceExpression();
            }
            this.props.handleSliceRequest({ slice });
            this.setState({ sliceExpression: slice, inputValue: slice });
        }
    }

    public render() {
        return (
            <details className="slicing-control">
                <summary className="slice-summary">
                    <span className="slice-summary-detail">SLICING</span>
                    {this.renderReadonlyIndicator()}
                </summary>
                <form onSubmit={this.handleSubmit} className="slice-form">
                    <div className="slice-enablement-checkbox-container">
                        <input
                            type="checkbox"
                            id="slice-enablement-checkbox"
                            className="slice-enablement-checkbox"
                            onChange={this.toggleEnablement}
                            disabled={this.props.loadingData}
                        />
                        <label htmlFor="slice-enablement-checkbox">Slice Data</label>
                    </div>
                    <div className="slice-control-row" style={{ marginTop: '10px' }}>
                        <TextField
                            value={this.state.inputValue}
                            styles={textFieldStyles}
                            onGetErrorMessage={this.validateSliceExpression}
                            onChange={this.handleChange}
                            autoComplete="on"
                            inputClassName="slice-data"
                            disabled={!this.state.isEnabled || this.props.loadingData}
                        />
                        <input
                            className="submit-slice-button"
                            type="submit"
                            disabled={!this.state.isEnabled || this.props.loadingData}
                            value="Apply"
                        />
                    </div>
                    {this.generateDropdowns()}
                </form>
            </details>
        );
    }

    private generateIndexHandler = (index: number) => {
        return (_data: React.FormEvent, option: IDropdownOption | undefined) => {
            const state: { [key: string]: number } = {};
            state[`selectedIndex${index}`] = option?.key as number;
            this.setState(state);
            this.applyDropdownsToInputBox();
        };
    };

    private generateAxisHandler = (index: number) => {
        return (_data: React.FormEvent, option: IDropdownOption | undefined) => {
            const state: { [key: string]: number } = {};
            state[`selectedAxis${index}`] = option?.key as number;
            this.setState(state);
            this.applyDropdownsToInputBox();
        };
    };

    private generateDropdowns = () => {
        const ndim = this.props.originalVariableShape.length;
        const numDropdowns = Math.max(ndim - 2, 1); // Ensure at least 1 set of dropdowns for 2D data
        const dropdowns = [];

        for (let i = 0; i < numDropdowns; i++) {
            const updateIndexHandler = this.generateIndexHandler(i);
            const updateAxisHandler = this.generateAxisHandler(i);
            const axisOptions = this.generateAxisDropdownOptions();
            const indexOptions = this.generateIndexDropdownOptions(i);
            const axisKey = this.state[`selectedAxis${i}`] as number;
            const indexKey = this.state[`selectedIndex${i}`] as number;

            dropdowns.push(
                <div className="slice-control-row">
                    <Dropdown
                        responsiveMode={ResponsiveMode.xxxLarge}
                        label="Axis"
                        style={{ marginRight: '10px' }}
                        styles={dropdownStyles}
                        disabled={!this.state.isEnabled || this.props.loadingData}
                        selectedKey={axisKey}
                        key={`axis${i}`}
                        options={axisOptions}
                        className="dropdownTitleOverrides"
                        onChange={updateAxisHandler}
                    />
                    <Dropdown
                        responsiveMode={ResponsiveMode.xxxLarge}
                        label="Index"
                        styles={dropdownStyles}
                        disabled={
                            !this.state.isEnabled ||
                            this.state[`selectedAxis${i}`] === undefined ||
                            this.state[`selectedAxis${i}`] === null ||
                            this.props.loadingData
                        }
                        selectedKey={indexKey}
                        key={`index${i}`}
                        options={indexOptions}
                        className="dropdownTitleOverrides"
                        onChange={updateIndexHandler}
                    />
                </div>
            );
        }
        return dropdowns;
    };

    private renderReadonlyIndicator = () => {
        if (this.state.isEnabled) {
            return <span className="slice-summary-detail current-slice">{this.state.sliceExpression}</span>;
        }
    };

    private toggleEnablement = () => {
        const willBeEnabled = !this.state.isEnabled;
        const newState = { isEnabled: willBeEnabled };
        const fullVariableSlice = this.fullSliceExpression();
        // Don't send slice request unless necessary
        if (this.state.sliceExpression !== fullVariableSlice) {
            const slice = willBeEnabled ? this.state.sliceExpression : fullVariableSlice;
            this.props.handleSliceRequest({ slice });
        }
        this.applyInputBoxToDropdowns();
        this.setState(newState);
    };

    private handleChange = (
        _event: React.FormEvent<HTMLInputElement | HTMLTextAreaElement>,
        newValue: string | undefined
    ) => {
        this.setState({ inputValue: newValue ?? '' });
    };

    private handleSubmit = (event: React.SyntheticEvent) => {
        event.preventDefault();
        if (this.state.inputValue !== this.state.sliceExpression) {
            this.setState({ sliceExpression: this.state.inputValue });
            // Update axis and index dropdown selections
            this.applyInputBoxToDropdowns();
            this.props.handleSliceRequest({
                slice: this.state.inputValue
            });
        }
    };

    /**
     * 
     * @returns A Python slice expression with the 0th index preselected along 
     * the first ndim - 2 axes. For example, for a 5D array with shape
     * (10, 20, 30, 40, 50), the preselected slice expression is [0, 0, 0, :, :].
     */
    private preselectedSliceExpression() {
        let numDimensionsToPreselect = this.props.originalVariableShape.length - 2;
        return (
            '[' +
            this.props.originalVariableShape
                .map(() => {
                    if (numDimensionsToPreselect > 0) {
                        numDimensionsToPreselect -= 1;
                        return '0';
                    }
                    return ':';
                })
                .join(', ') +
            ']'
        );
    }

    private fullSliceExpression() {
        return '[' + this.props.originalVariableShape.map(() => ':').join(', ') + ']';
    }

    private validateSliceExpression = (sliceExpression: string) => {
        if (sliceExpression.startsWith('[') && sliceExpression.endsWith(']')) {
            let hasOutOfRangeIndex: { shapeIndex: number; value: number } | undefined;
            const parsedExpression = sliceExpression
                .substring(1, sliceExpression.length - 1)
                .split(',')
                .map((shapeEl, shapeIndex) => {
                    // Validate IndexErrors
                    const match = sliceRegEx.exec(shapeEl);
                    if (match?.groups?.Start && !match.groups.Stop) {
                        const value = parseInt(match.groups.Start);
                        const numberOfElementsAlongAxis = this.props.originalVariableShape[shapeIndex];
                        if (
                            (value >= 0 && value >= numberOfElementsAlongAxis) ||
                            // Python allows negative index values
                            (value < 0 && value < -numberOfElementsAlongAxis)
                        ) {
                            hasOutOfRangeIndex = { shapeIndex, value };
                        }
                        return value;
                    }
                });

            if (hasOutOfRangeIndex) {
                const { shapeIndex, value } = hasOutOfRangeIndex;
                return `IndexError at axis ${shapeIndex}, index ${value}`;
            } else if (parsedExpression && parsedExpression.length !== this.props.originalVariableShape.length) {
                return 'Invalid slice expression';
            }
        }
        return '';
    };

    private applyInputBoxToDropdowns = () => {
        setTimeout(() => {
            const shape = this.state.sliceExpression;
            if (shape.startsWith('[') && shape.endsWith(']')) {
                const dropdowns: { axis: number; index: number }[] = [];
                let numRangeObjects = 0;
                shape
                    .substring(1, shape.length - 1)
                    .split(',')
                    .forEach((shapeEl, idx) => {
                        // Validate the slice object
                        const match = sliceRegEx.exec(shapeEl);
                        if (match?.groups?.Start && !match.groups.Stop) {
                            // Can map index expressions like [2, :, :] to dropdowns
                            dropdowns.push({ axis: idx, index: parseInt(match.groups.Start) });
                        } else if (match?.groups?.StopRange !== undefined || match?.groups?.StartRange !== undefined) {
                            // Can't map expressions like [0:, :] to dropdown
                            numRangeObjects += 1;
                        }
                    });
                const state = {};
                const ndim = this.props.originalVariableShape.length;
                if (numRangeObjects === 0 && dropdowns.length === Math.max(1, ndim - 2)) {
                    // Apply values to dropdowns
                    for (let i = 0; i < dropdowns.length; i++) {
                        const selection = dropdowns[i];
                        (state as any)[`selectedAxis${i.toString()}`] = selection.axis;
                        (state as any)[`selectedIndex${i.toString()}`] = selection.index;
                    }
                } else {
                    // Unset dropdowns
                    for (const key in this.state) {
                        if (key.startsWith('selected')) {
                            (state as any)[key] = null;
                        }
                    }
                }
                this.setState(state);
            }
        });
    };

    private applyDropdownsToInputBox = () => {
        setTimeout(() => {
            const shape = this.props.originalVariableShape.map(() => ':');
            const ndim = this.props.originalVariableShape.length;
            const numDropdowns = Math.max(ndim - 2, 1); // Ensure at least 1 set of dropdowns for 2D data

            for (let i = 0; i < numDropdowns; i++) {
                const selectedAxisKey = this.state[`selectedAxis${i}`] as number;
                const selectedIndexKey = this.state[`selectedIndex${i}`] as number;
                if (
                    selectedAxisKey !== null &&
                    selectedAxisKey !== undefined &&
                    selectedIndexKey !== null &&
                    selectedIndexKey !== undefined
                ) {
                    shape[selectedAxisKey] = selectedIndexKey.toString();
                }
            }

            const newSliceExpression = '[' + shape.join(', ') + ']';
            if (newSliceExpression !== this.state.sliceExpression) {
                this.setState({ sliceExpression: newSliceExpression, inputValue: newSliceExpression });
                this.props.handleSliceRequest({ slice: newSliceExpression });
            }
        });
    };

    private generateAxisDropdownOptions = () => {
        const selectedAxes = new Set();
        for (const key in this.state) {
            if (key.startsWith('selectedAxis')) {
                selectedAxes.add(this.state[key]);
            }
        }
        // Disable axes which are already selected in other dropdowns
        // in order to prevent users from selecting the same axis twice
        return this.props.originalVariableShape.map((_val, idx) => {
            return { key: idx, text: idx.toString(), disabled: selectedAxes.has(idx) };
        });
    };

    private generateIndexDropdownOptions = (dropdownIndex: number) => {
        const axisSelection = this.state[`selectedAxis${dropdownIndex}`];
        if (axisSelection !== undefined) {
            const range = this.props.originalVariableShape[axisSelection as number];
            const result = [];
            for (let i = 0; i < range; i++) {
                result.push({ key: i, text: i.toString() });
            }
            return result;
        }
        return [];
    };
}
