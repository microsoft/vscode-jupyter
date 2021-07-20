// These styles are passed to the FluentUI dropdown controls
const styleOverrides = {
    color: 'var(--vscode-dropdown-foreground) !important',
    backgroundColor: 'var(--vscode-dropdown-background) !important',
    fontFamily: 'var(--vscode-font-family)',
    fontWeight: 'var(--vscode-font-weight)',
    fontSize: 'var(--vscode-font-size)',
    opacity: 1,
    border: 'var(--vscode-dropdown-border)',
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

export const dropdownStyles = {
    root: {
        color: 'var(--vscode-dropdown-foreground) !important'
    },
    dropdownItems: {
        ...styleOverrides,
        selectors: {
            '@media(min-width: 300px)': {
                maxHeight: 200
            }
        }
    },
    caretDown: {
        visibility: 'hidden' // Override the FluentUI caret and use ::after selector on the caretDownWrapper in order to match VS Code. See sliceContro.css
    }
};

export const dropdownStyle = { marginRight: '10px', width: '98%', marginBottom: '16px' };

export const buttonStyle = {
    backgroundColor: 'var(--vscode-button-background)',
    color: 'var(--vscode-button-foreground)',
    margin: '4px 8px 4px 0px',
    padding: '8px',
    border: 'none',
    cursor: 'pointer',
    height: '26px',
    marginLeft: '0px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '54px',
    ':disabled': {
        opacity: 0.4,
        color: 'red'
    }
};

export const applyButtonStyle = {
    ...buttonStyle
};

export const clearButtonStyle = {
    ...buttonStyle,
    backgroundColor: 'var(--vscode-button-secondaryBackground)',
    color: 'var(--vscode-button-secondaryForeground)'
};

export const inputStyle = { width: '100%', marginTop: '4px', marginBottom: '16px' };
