import pandas as _VSCODE_pd
import builtins as _VSCODE_builtins
import json as _VSCODE_json
import numpy as _VSCODE_np
import pandas.io.json as _VSCODE_pd_json

# PyTorch and TensorFlow tensors which can be converted to numpy arrays
_VSCODE_allowedTensorTypes = ["Tensor", "EagerTensor"]


class NumpyEncoder(_VSCODE_json.JSONEncoder):
    # Special json encoder for numpy types because they aren't serializable

    def default(self, obj):
        if isinstance(obj, _VSCODE_np.integer):
            return int(obj)
        elif isinstance(obj, _VSCODE_np.floating):
            return float(obj)
        elif isinstance(obj, _VSCODE_np.ndarray):
            return obj.tolist()
        return _VSCODE_json.JSONEncoder.default(self, obj)


def _VSCODE_stringifyElement(element):
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
    return stringified


def _VSCODE_convertNumpyArrayToDataFrame(ndarray, start=None, end=None):
    # Save the user's current setting
    current_options = _VSCODE_np.get_printoptions()
    # Ask for the full string. Without this numpy truncates to 3 leading and 3 trailing by default
    _VSCODE_np.set_printoptions(threshold=99999)

    flattened = None
    try:
        if start is not None and end is not None:
            ndarray = ndarray[start:end]
        if ndarray.ndim < 3 and str(ndarray.dtype) != "object":
            pass
        elif ndarray.ndim == 1 and str(ndarray.dtype) == "object":
            flattened = _VSCODE_np.empty(ndarray.shape[:2], dtype="object")
            for i in range(len(flattened)):
                flattened[i] = _VSCODE_stringifyElement(ndarray[i])
            ndarray = flattened
        else:
            flattened = _VSCODE_np.empty(ndarray.shape[:2], dtype="object")
            for i in range(len(flattened)):
                for j in range(len(flattened[i])):
                    flattened[i][j] = _VSCODE_stringifyElement(ndarray[i][j])
            ndarray = flattened
    finally:
        # Restore the user's printoptions
        _VSCODE_np.set_printoptions(threshold=current_options["threshold"])
        del flattened
        return _VSCODE_pd.DataFrame(ndarray)


# Function that converts tensors to DataFrames
def _VSCODE_convertTensorToDataFrame(tensor, start=None, end=None):
    try:
        temp = tensor
        # We were only asked for start:end rows, so don't
        # waste cycles computing the rest
        if temp.ndim > 0 and start is not None and end is not None:
            temp = temp[start:end]
        # Can't directly convert sparse tensors to numpy arrays
        # so first convert them to dense tensors
        if hasattr(temp, "is_sparse") and temp.is_sparse:
            # This guard is needed because to_dense exists on all PyTorch
            # tensors and throws an error if the tensor is already strided
            temp = temp.to_dense()
        # See https://discuss.pytorch.org/t/should-it-really-be-necessary-to-do-var-detach-cpu-numpy/35489
        if hasattr(temp, "data"):
            # PyTorch tensors need to be explicitly detached
            # from the computation graph and copied to CPU
            temp = temp.data.detach().cpu()
        # Two step conversion process required to convert tensors to DataFrames
        # tensor --> numpy array --> dataframe
        temp = temp.numpy()
        if temp.ndim == 0:
            temp = [temp]
        temp = _VSCODE_convertNumpyArrayToDataFrame(temp)
        tensor = temp
        del temp
    except AttributeError:
        # TensorFlow EagerTensors and PyTorch Tensors support numpy()
        # but avoid a crash just in case the current variable doesn't
        pass
    return tensor


# Function that converts the var passed in into a pandas data frame if possible
def _VSCODE_convertToDataFrame(df, start=None, end=None):
    vartype = type(df)
    if isinstance(df, list):
        df = _VSCODE_pd.DataFrame(df).iloc[start:end]
    elif isinstance(df, _VSCODE_pd.Series):
        df = _VSCODE_pd.Series.to_frame(df).iloc[start:end]
    elif isinstance(df, dict):
        df = _VSCODE_pd.Series(df)
        df = _VSCODE_pd.Series.to_frame(df).iloc[start:end]
    elif hasattr(df, "toPandas"):
        df = df.toPandas().iloc[start:end]
    elif (
        hasattr(vartype, "__name__") and vartype.__name__ in _VSCODE_allowedTensorTypes
    ):
        df = _VSCODE_convertTensorToDataFrame(df, start, end)
    elif hasattr(vartype, "__name__") and vartype.__name__ == "ndarray":
        df = _VSCODE_convertNumpyArrayToDataFrame(df, start, end)
    elif (
        hasattr(df, "__array__")
        and hasattr(vartype, "__name__")
        and vartype.__name__ == "DataArray"
    ):
        df = _VSCODE_convertNumpyArrayToDataFrame(df[start:end].__array__(), start, end)
    else:
        """Disabling bandit warning for try, except, pass. We want to swallow all exceptions here to not crash on
        variable fetching"""
        try:
            temp = _VSCODE_pd.DataFrame(df).iloc[start:end]
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
    df = _VSCODE_convertToDataFrame(df, start, end)
    # Turn into JSON using pandas. We use pandas because it's about 3 orders of magnitude faster to turn into JSON
    try:
        df = df.replace(
            {
                _VSCODE_np.inf: "inf",
                -_VSCODE_np.inf: "-inf",
                _VSCODE_np.nan: "nan",
            }
        )
    except:
        pass
    return _VSCODE_pd_json.to_json(None, df, orient="table", date_format="iso")


# Function to retrieve a set of rows for a data frame
def _VSCODE_getDataFrameColumn(df, columnName):
    if columnName not in df:
        return []
    df = _VSCODE_convertToDataFrame(df)
    # Turn into JSON using pandas. We use pandas because it's about 3 orders of magnitude faster to turn into JSON
    try:
        df = df.replace(
            {
                _VSCODE_np.inf: "inf",
                -_VSCODE_np.inf: "-inf",
                _VSCODE_np.nan: "nan",
            }
        )
    except:
        pass
    return df[columnName].tolist()


# Function to get info on the passed in data frame
def _VSCODE_getDataFrameInfo(df):
    def get_col(df, column_name):
        try:
            col = df[column_name]
            return col
        # Columns don't have names, so get column with index
        except KeyError:
            col = df[int(column_name)]
            return col

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

    columnTypes = _VSCODE_builtins.list(df.dtypes)

    # Compute the index column. It may have been renamed
    try:
        indexColumn = df.index.name if df.index.name else "index"
    except AttributeError:
        indexColumn = "index"

    # Make sure the index column exists
    if indexColumn not in columnNames:
        columnNames.insert(0, indexColumn)
        columnTypes.insert(0, "int64")

    target = {}
    # PreviewDiff is a dict with keys as row indices
    # and values as dicts with keys as column names and values as class names for css styling
    # Eg. {3: {'age': 'red'}} means that the cell in row 3, column 'age' has class name 'red'
    target["previewDiffs"] = {}

    # Then loop and generate our output json
    columns = []
    for n in _VSCODE_builtins.range(0, _VSCODE_builtins.len(columnNames)):
        column_type = columnTypes[n]
        column_name = str(columnNames[n])
        colobj = {}
        colobj["key"] = column_name
        colobj["name"] = column_name
        colobj["type"] = str(column_type)

        # Needed for Data Wrangler
        length = len(df)
        if column_name != "index":
            col = get_col(df, column_name)
            describe_obj = col.describe()

            colobj["totalCount"] = col.count()
            colobj["missingCount"] = col.isna().sum()
            # Unique count is number of rows minus number of repeated values
            colobj["uniqueCount"] = col.shape[0] - col.duplicated().sum()
            if str(column_type) == "object" or str(column_type) == "string":
                colobj["mostFrequentValue"] = describe_obj.top
                colobj["mostFrequentValueAppearances"] = (
                    0 if _VSCODE_np.isnan(describe_obj.freq) else describe_obj.freq
                )
            else:
                statistics = {}
                statistics["average"] = round(col.mean(), 2)
                statistics["median"] = col.median()
                statistics["min"] = col.min()
                statistics["max"] = col.max()
                statistics["sd"] = round(col.std(), 2)
                colobj["statistics"] = statistics

        columns.append(colobj)

        # Check if column is a preview column and if so, check to see if old column and preview column have different values
        if "(preview)" in column_name:
            # Preview column is always the column after the old column
            old_column_name = columnNames[n - 1]

            # Find row indices where two values in the columns differ
            # Also makes sure that Nan and Nan mean the same value
            rows = df.index[
                _VSCODE_np.where(
                    ~(
                        df[column_name].eq(df[old_column_name])
                        | (df[column_name].isna() & df[old_column_name].isna())
                    )
                )
            ].tolist()
            for row in rows:
                if row not in target["previewDiffs"]:
                    target["previewDiffs"][row] = {}
                # Need to increment by 1 because we add a new column in the slick grid
                target["previewDiffs"][row][n] = "react-grid-cell-before-diff"
                target["previewDiffs"][row][n + 1] = "react-grid-cell-preview-diff"

    # Save this in our target
    target["columns"] = columns
    target["indexColumn"] = indexColumn
    target["rowCount"] = rowCount

    # Count duplicate rows
    target["duplicateRowsCount"] = int(df.duplicated(keep="first").sum())

    # Count rows with missing values
    # Will be highlighted on drop missing rows preview operation
    target["nanRows"] = df[df.isnull().any(axis=1)].index.values.tolist()

    # return our json object as a string
    return _VSCODE_json.dumps(target, cls=NumpyEncoder)
