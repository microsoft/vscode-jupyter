# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.

import os
import builtins
import json

builtins.print(json.dumps(dict(os.environ)))
