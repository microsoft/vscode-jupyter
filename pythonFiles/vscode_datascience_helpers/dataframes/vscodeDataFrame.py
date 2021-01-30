import pandas as _VSCODE_pd
import builtins as _VSCODE_builtins
import json as _VSCODE_json
import numpy as _VSCODE_np
import pandas.io.json as _VSCODE_pd_json

# PyTorch and TensorFlow tensors which can be converted to numpy arrays
_VSCODE_allowedTensorTypes = ["Tensor", "EagerTensor"]

# Convert numpy array to DataFrame
def _VSCODE_convertNumpyArrayToDataFrame(ndarray):
    # Save the user's current setting
    current_options = _VSCODE_np.get_printoptions()
    # Ask for the full string. Without this numpy truncates to 3 leading and 3 trailing by default
    _VSCODE_np.set_printoptions(threshold=99999)
    temp = ndarray

    try:
        x_len = temp.shape[0]
        y_len = None
        # Figure out if we're dealing with ragged data
        # Handle ragged arrays by making a container where the number of
        # columns is the max length of all rows. Missing elements are
        # represented as empty strings.
        y_len = max([len(temp[i]) for i in range(x_len)])

        if y_len:
            # Figure out what kind of object the rows are
            flattened = _VSCODE_np.full((x_len, y_len), "", dtype="object")
            for i in range(x_len):
                for j in range(len(temp[i])):
                    element = temp[i][j]
                    if isinstance(element, _VSCODE_np.ndarray):
                        # Ensure no rjust or ljust padding is applied to stringified elements
                        stringified = _VSCODE_np.array2string(
                            element, separator=", ", formatter={"all": lambda x: str(x)}
                        )
                    elif isinstance(element, (list, tuple)):
                        # We can't pass lists and tuples to array2string because it expects
                        # the size attribute to be defined
                        stringified = str(element)
                    else:
                        stringified = element
                    flattened[i][j] = stringified
            temp = flattened
    except TypeError:
        # Ragged as well as 1D ndarrays both have ndim==1, but computing
        # y_len for 1D ndarray will raise a TypeError
        pass  # nosec
    finally:
        # Restore the user's printoptions
        _VSCODE_np.set_printoptions(threshold=current_options["threshold"])
        temp = _VSCODE_pd.DataFrame(temp)
        ndarray = temp
        del temp
        return ndarray


# Function that converts tensors to DataFrames
def _VSCODE_convertTensorToDataFrame(tensor):
    try:
        temp = tensor
        # Can't directly convert sparse tensors to numpy arrays
        # so first convert them to dense tensors
        if hasattr(temp, "is_sparse") and temp.is_sparse:
            # This guard is needed because to_dense exists on all PyTorch
            # tensors and throws an error if the tensor is already strided
            temp = temp.to_dense()
        # Two step conversion process required to convert tensors to DataFrames
        # tensor --> numpy array --> dataframe
        temp = temp.numpy()
        temp = _VSCODE_convertNumpyArrayToDataFrame(temp)
        tensor = temp
        del temp
    except AttributeError:
        # TensorFlow EagerTensors and PyTorch Tensors support numpy()
        # but avoid a crash just in case the current variable doesn't
        pass
    return tensor


# Function that converts the var passed in into a pandas data frame if possible
def _VSCODE_convertToDataFrame(df):
    vartype = type(df)
    if isinstance(df, list):
        df = _VSCODE_pd.DataFrame(df)
    elif isinstance(df, _VSCODE_pd.Series):
        df = _VSCODE_pd.Series.to_frame(df)
    elif isinstance(df, dict):
        df = _VSCODE_pd.Series(df)
        df = _VSCODE_pd.Series.to_frame(df)
    elif hasattr(df, "toPandas"):
        df = df.toPandas()
    elif (
        hasattr(vartype, "__name__") and vartype.__name__ in _VSCODE_allowedTensorTypes
    ):
        df = _VSCODE_convertTensorToDataFrame(df)
    elif hasattr(vartype, "__name__") and vartype.__name__ == "ndarray":
        df = _VSCODE_convertNumpyArrayToDataFrame(df)
    else:
        """Disabling bandit warning for try, except, pass. We want to swallow all exceptions here to not crash on
        variable fetching"""
        try:
            temp = _VSCODE_pd.DataFrame(df)
            df = temp
        except:  # nosec
            pass
    del vartype
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
    rows = rows.replace(
        {
            _VSCODE_np.inf: "_VSCODE_infinity",
            -_VSCODE_np.inf: "_VSCODE_neg_infinity",
            _VSCODE_np.nan: "_VSCODE_nan",
        }
    )
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
