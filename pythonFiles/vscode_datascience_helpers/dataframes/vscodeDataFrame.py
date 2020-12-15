import pandas as _VSCODE_pd
import builtins as _VSCODE_builtins
import json as _VSCODE_json
import pandas.io.json as _VSCODE_pd_json

# Function that converts the var passed in into a pandas data frame if possible
def _VSCODE_convertToDataFrame(df):
    if isinstance(df, list):
        df = _VSCODE_pd.DataFrame(df)
    elif isinstance(df, _VSCODE_pd.Series):
        df = _VSCODE_pd.Series.to_frame(df)
    elif isinstance(df, dict):
        df = _VSCODE_pd.Series(df)
        df = _VSCODE_pd.Series.to_frame(df)
    elif hasattr(df, "toPandas"):
        df = df.toPandas()
    else:
        """Disabling bandit warning for try, except, pass. We want to swallow all exceptions here to not crash on
        variable fetching"""
        try:
            temp = _VSCODE_pd.DataFrame(df)
            df = temp
        except:  # nosec
            pass
    return df


# Function to compute row count for a value
def _VSCODE_getRowCount(var):
    if hasattr(var, "shape"):
        try:
            # Get a bit more restrictive with exactly what we want to count as a shape, since anything can define it
            if isinstance(var.shape, tuple):
                return var.shape[0]
        except TypeError:
            return 0
    elif hasattr(var, "__len__"):
        try:
            return _VSCODE_builtins.len(var)
        except TypeError:
            return 0


# Function to retrieve a set of rows for a data frame
def _VSCODE_getDataFrameRows(df, start, end):
    df = _VSCODE_convertToDataFrame(df)

    # Turn into JSON using pandas. We use pandas because it's about 3 orders of magnitude faster to turn into JSON
    rows = df.iloc[start:end]
    return _VSCODE_pd_json.to_json(None, rows, orient="table", date_format="iso")


# Function to get info on the passed in data frame
def _VSCODE_getDataFrameInfo(df):
    df = _VSCODE_convertToDataFrame(df)
    rowCount = _VSCODE_getRowCount(df)

    # If any rows, use pandas json to convert a single row to json. Extract
    # the column names and types from the json so we match what we'll fetch when
    # we ask for all of the rows
    if rowCount:
        try:
            row = df.iloc[0:1]
            json_row = _VSCODE_pd_json.to_json(None, row, date_format="iso")
            columnNames = list(_VSCODE_json.loads(json_row))
        except:
            columnNames = list(df)
    else:
        columnNames = list(df)

    # Compute the index column. It may have been renamed
    try:
        indexColumn = df.index.name if df.index.name else "index"
    except AttributeError:
        indexColumn = "index"

    columnTypes = _VSCODE_builtins.list(df.dtypes)

    # Make sure the index column exists
    if indexColumn not in columnNames:
        columnNames.insert(0, indexColumn)
        columnTypes.insert(0, "int64")

    # Then loop and generate our output json
    columns = []
    for n in _VSCODE_builtins.range(0, _VSCODE_builtins.len(columnNames)):
        column_type = columnTypes[n]
        column_name = str(columnNames[n])
        colobj = {}
        colobj["key"] = column_name
        colobj["name"] = column_name
        colobj["type"] = str(column_type)
        columns.append(colobj)

    # Save this in our target
    target = {}
    target["columns"] = columns
    target["indexColumn"] = indexColumn
    target["rowCount"] = rowCount

    # return our json object as a string
    return _VSCODE_json.dumps(target)
