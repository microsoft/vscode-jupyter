# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.

import os
import site

# Copied from site-packages/jupyter_core/paths.py

if site.ENABLE_USER_SITE:
    # Check if site.getuserbase() exists to be compatible with virtualenv,
    # which often does not have this method.
    userbase: Optional[str]
    if hasattr(site, "getuserbase"):
        userbase = site.getuserbase()
    else:
        userbase = site.USER_BASE

    if userbase:
        userdir = os.path.join(userbase, "share", "jupyter")
        print(userdir)
